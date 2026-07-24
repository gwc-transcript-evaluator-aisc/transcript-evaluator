import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  OrchestrationRunSchema,
  type FailedStage,
  type OrchestrationRun,
  type OrchestrationRunStatus,
  type ResultLocator,
} from '../domain/orchestration-run.js';

export type CreateRunInput = Pick<OrchestrationRun, 'runId' | 'requestId' | 'transcriptId' | 'degreeProgramId'>;
export type CreateRunResult =
  | { kind: 'created'; run: OrchestrationRun }
  | { kind: 'existing'; run: OrchestrationRun }
  | { kind: 'conflict'; run: OrchestrationRun };

const legalTransitions: Readonly<Record<OrchestrationRunStatus, readonly OrchestrationRunStatus[]>> = {
  pending: ['matching', 'failed'],
  matching: ['evaluating', 'failed'],
  evaluating: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export function isLegalRunTransition(from: OrchestrationRunStatus, to: OrchestrationRunStatus): boolean {
  return legalTransitions[from].includes(to);
}

export class RunsStore {
  public constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async create(input: CreateRunInput): Promise<CreateRunResult> {
    const timestamp = this.now().toISOString();
    const run = OrchestrationRunSchema.parse({ ...input, status: 'pending', createdAt: timestamp, updatedAt: timestamp });
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: run,
        ConditionExpression: 'attribute_not_exists(runId)',
      }));
      return { kind: 'created', run };
    } catch (error) {
      if (errorName(error) !== 'ConditionalCheckFailedException') throw error;
      const existing = await this.get(input.runId);
      if (!existing) throw error;
      return sameInputs(existing, input) ? { kind: 'existing', run: existing } : { kind: 'conflict', run: existing };
    }
  }

  public async get(runId: string): Promise<OrchestrationRun | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { runId }, ConsistentRead: true }));
    return response.Item ? OrchestrationRunSchema.parse(response.Item) : undefined;
  }

  public async transition(runId: string, from: OrchestrationRunStatus, to: OrchestrationRunStatus, resultLocator?: ResultLocator): Promise<OrchestrationRun | undefined> {
    if (!isLegalRunTransition(from, to)) throw new Error(`Illegal run transition: ${from} -> ${to}`);
    const updatedAt = this.now().toISOString();
    const names: Record<string, string> = { '#status': 'status', '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = { ':from': from, ':to': to, ':updatedAt': updatedAt };
    let updateExpression = 'SET #status = :to, #updatedAt = :updatedAt';
    if (to === 'completed') {
      if (!resultLocator) throw new Error('Completed transitions require a result locator');
      names['#resultLocator'] = 'resultLocator';
      values[':resultLocator'] = resultLocator;
      updateExpression += ', #resultLocator = :resultLocator';
    }
    return this.conditionalUpdate(runId, from, updateExpression, names, values);
  }

  public async markFailed(runId: string, from: Exclude<OrchestrationRunStatus, 'completed' | 'failed'>, failedStage: FailedStage, failureCode: string, failureMessage: string): Promise<OrchestrationRun | undefined> {
    const updatedAt = this.now().toISOString();
    return this.conditionalUpdate(
      runId,
      from,
      'SET #status = :failed, #updatedAt = :updatedAt, #failedStage = :failedStage, #failureCode = :failureCode, #failureMessage = :failureMessage',
      { '#status': 'status', '#updatedAt': 'updatedAt', '#failedStage': 'failedStage', '#failureCode': 'failureCode', '#failureMessage': 'failureMessage' },
      { ':failed': 'failed', ':updatedAt': updatedAt, ':failedStage': failedStage, ':failureCode': failureCode, ':failureMessage': failureMessage },
    );
  }

  private async conditionalUpdate(runId: string, from: OrchestrationRunStatus, updateExpression: string, names: Record<string, string>, values: Record<string, unknown>): Promise<OrchestrationRun | undefined> {
    try {
      const response = await this.client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { runId },
        UpdateExpression: updateExpression,
        ConditionExpression: '#status = :from',
        ExpressionAttributeNames: names,
        // The ConditionExpression always references :from, so inject it here to guarantee
        // it is defined regardless of which caller-supplied values are passed (markFailed
        // previously omitted it, causing a DynamoDB ValidationException).
        ExpressionAttributeValues: { ...values, ':from': from },
        ReturnValues: 'ALL_NEW',
      }));
      return response.Attributes ? OrchestrationRunSchema.parse(response.Attributes) : undefined;
    } catch (error) {
      if (errorName(error) === 'ConditionalCheckFailedException') return undefined;
      throw error;
    }
  }
}

function sameInputs(run: OrchestrationRun, input: CreateRunInput): boolean {
  return run.runId === input.runId
    && run.requestId === input.requestId
    && run.transcriptId === input.transcriptId
    && run.degreeProgramId === input.degreeProgramId;
}

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : undefined;
}
