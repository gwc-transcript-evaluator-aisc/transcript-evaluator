import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';

const DEFAULT_BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-5';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const LOG_RETENTION = logs.RetentionDays.ONE_MONTH;
const MAP_CONCURRENCY = 10;
const PAIR_PAGE_SIZE = 100;
const transientErrors = ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException', 'DynamoDB.ProvisionedThroughputExceededException', 'DynamoDB.ThrottlingException', 'States.Timeout'];

export interface ArticulationOrchestratorStackProps extends StackProps {
  /** Local stacks explicitly bypass shared API-key verification for local development only. */
  readonly local?: boolean;
  readonly transcriptApiBaseUrl?: string;
  readonly bedrockModelId?: string;
}

export class ArticulationOrchestratorStack extends Stack {
  /** Base URL of the HTTP API, consumed by the frontend-hosting stack. */
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ArticulationOrchestratorStackProps = {}) {
    super(scope, id, props);

    const tableDefaults = { billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, encryption: dynamodb.TableEncryption.AWS_MANAGED, pointInTimeRecovery: true, removalPolicy: RemovalPolicy.RETAIN };
    const runs = new dynamodb.Table(this, 'Runs', { ...tableDefaults, partitionKey: { name: 'runId', type: dynamodb.AttributeType.STRING } });
    const work = new dynamodb.Table(this, 'Work', { ...tableDefaults, partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, timeToLiveAttribute: 'expiresAt' });
    const results = new dynamodb.Table(this, 'Results', { ...tableDefaults, partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING } });
    results.addGlobalSecondaryIndex({ indexName: 'byStudent', partitionKey: { name: 'studentKey', type: dynamodb.AttributeType.STRING }, sortKey: { name: 'studentResultKey', type: dynamodb.AttributeType.STRING }, projectionType: dynamodb.ProjectionType.ALL });
    const catalogCache = new dynamodb.Table(this, 'CatalogCache', { ...tableDefaults, partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, timeToLiveAttribute: 'expiresAt' });
    const catalogTable = dynamodb.Table.fromTableArn(this, 'CatalogTable', Fn.importValue('CourseCatalogApiStack-CatalogTableArn'));
    const evaluatorFunction = lambda.Function.fromFunctionArn(this, 'EvaluatorFunction', Fn.importValue('ArticulationEvaluatorStack-EvaluateArticulationArn'));

    const workerEnvironment = {
      RUNS_TABLE_NAME: runs.tableName, WORK_TABLE_NAME: work.tableName, RESULTS_TABLE_NAME: results.tableName,
      CATALOG_CACHE_TABLE_NAME: catalogCache.tableName, CATALOG_TABLE_NAME: catalogTable.tableName,
      EVALUATOR_FUNCTION_ARN: evaluatorFunction.functionArn,
      TRANSCRIPT_API_BASE_URL: props.transcriptApiBaseUrl ?? Fn.importValue('TranscriptProcessorStack-ApiUrl'),
      BEDROCK_MODEL_ID: props.bedrockModelId ?? DEFAULT_BEDROCK_MODEL_ID,
      // Worker handlers do not start executions, but share the validated runtime config.
      STATE_MACHINE_ARN: 'workflow-worker',
    };
    const workflowWorker = (id: string, entry: string, timeout = Duration.seconds(90)) => new nodejs.NodejsFunction(this, id, {
      entry: path.join(currentDirectory, '..', 'src', 'handlers', entry), handler: 'handler', runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512, timeout, logRetention: LOG_RETENTION, environment: workerEnvironment,
      bundling: { format: nodejs.OutputFormat.ESM, minify: true, sourceMap: true },
    });
    // These handlers persist work/results; their state-machine inputs are compact locators only.
    const setRunStatus = workflowWorker('SetRunStatus', 'workflow-set-run-status.ts');
    const prepareRun = workflowWorker('PrepareRun', 'workflow-prepare-run.ts', Duration.minutes(5));
    const matchRequiredCourse = workflowWorker('MatchRequiredCourse', 'workflow-match-required-course.ts');
    const listPairRefs = workflowWorker('ListPairRefsWorker', 'workflow-list-pair-refs.ts');
    const evaluateCoursePair = workflowWorker('EvaluateCoursePair', 'evaluate-course-pair.ts');
    const finalizeResult = workflowWorker('FinalizeResultWorker', 'workflow-finalize-result.ts', Duration.minutes(2));
    const failRun = workflowWorker('FailRun', 'workflow-fail-run.ts');
    const recordMatchingFailure = workflowWorker('RecordMatchingFailure', 'workflow-record-matching-failure.ts');
    const recordEvaluationFailure = workflowWorker('RecordEvaluationFailure', 'workflow-record-evaluation-failure.ts');
    for (const worker of [setRunStatus, prepareRun, matchRequiredCourse, listPairRefs, evaluateCoursePair, finalizeResult, failRun, recordMatchingFailure, recordEvaluationFailure]) {
      runs.grantReadWriteData(worker);
      work.grantReadWriteData(worker);
    }
    catalogTable.grantReadData(prepareRun);
    catalogCache.grantReadWriteData(prepareRun);
    // The evaluator is deployed by a separate stack and imported by ARN. Grant the
    // worker role directly so synthesis never tries to mutate the imported function.
    evaluateCoursePair.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [evaluatorFunction.functionArn],
    }));
    results.grantReadWriteData(finalizeResult);
    // The Converse/ConverseStream APIs are authorized by bedrock:InvokeModel (there is no
    // bedrock:Converse IAM action), so granting Converse leaves the call unauthorized.
    for (const worker of [prepareRun, matchRequiredCourse]) worker.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [`arn:aws:bedrock:*:${this.account}:inference-profile/*`, 'arn:aws:bedrock:*::foundation-model/*'],
    }));

    const retry = (task: sfn.TaskStateBase) => task.addRetry({ errors: transientErrors, interval: Duration.seconds(2), maxAttempts: 3, backoffRate: 2 });
    const invoke = (id: string, fn: lambda.IFunction, payload: Record<string, unknown>) => retry(new sfnTasks.LambdaInvoke(this, id, {
      lambdaFunction: fn, payload: sfn.TaskInput.fromObject(payload), payloadResponseOnly: true,
    }));
    const failure = (id: string, failedStage: 'matching' | 'evaluating' | 'persisting') => {
      const record = invoke(`${id}Run`, failRun, { 'runId.$': '$.runId', failedStage, 'error.$': '$' });
      return record.next(new sfn.Fail(this, id, { error: 'RUN_FAILED', cause: 'The orchestration run failed.' }));
    };
    const matchingFailure = failure('MatchingFailed', 'matching');
    const evaluatingFailure = failure('EvaluatingFailed', 'evaluating');
    const persistingFailure = failure('PersistingFailed', 'persisting');

    const setMatchingStatus = invoke('SetMatchingStatus', setRunStatus, { 'runId.$': '$.runId', from: 'pending', to: 'matching' });
    const prepare = invoke('PrepareRunTask', prepareRun, { 'runId.$': '$.runId', 'transcriptId.$': '$.transcriptId', 'degreeProgramId.$': '$.degreeProgramId' });
    // Inside the Map iterator, read the fields the itemSelector produced ($.requiredCourseId).
    // $$.Map.Item.Value is only resolvable at the Map's itemSelector level, not in sub-states.
    const matchingWorker = invoke('MatchRequiredCourseTask', matchRequiredCourse, { 'runId.$': '$.runId', 'requiredCourseId.$': '$.requiredCourseId' });
    const matchingItemFailure = invoke('PersistMatchingItemFailure', recordMatchingFailure, { 'runId.$': '$.runId', 'requiredCourseId.$': '$.requiredCourseId' });
    matchingWorker.addCatch(matchingItemFailure, { resultPath: sfn.JsonPath.DISCARD });
    const matchingMap = new sfn.Map(this, 'MatchingMap', {
      itemsPath: '$.requiredCourseIds', maxConcurrency: MAP_CONCURRENCY, resultPath: sfn.JsonPath.DISCARD,
      itemSelector: { 'runId.$': '$.runId', 'requiredCourseId.$': '$$.Map.Item.Value' },
    }).itemProcessor(matchingWorker);
    const setEvaluatingStatus = invoke('SetEvaluatingStatus', setRunStatus, { 'runId.$': '$.runId', from: 'matching', to: 'evaluating' });

    // The first page deliberately omits cursor; later pages receive only its opaque locator.
    const listFirstPairRefs = invoke('ListPairRefs', listPairRefs, { 'runId.$': '$.runId', pageSize: PAIR_PAGE_SIZE });
    const listNextPairRefs = invoke('ListNextPairRefs', listPairRefs, { 'runId.$': '$.runId', 'cursor.$': '$.nextCursor', pageSize: PAIR_PAGE_SIZE });
    const evaluationWorker = invoke('EvaluateCoursePairTask', evaluateCoursePair, { 'runId.$': '$.runId', 'pairId.$': '$.pairId' });
    const evaluationItemFailure = invoke('PersistEvaluationItemFailure', recordEvaluationFailure, { 'runId.$': '$.runId', 'pairId.$': '$.pairId' });
    evaluationWorker.addCatch(evaluationItemFailure, { resultPath: sfn.JsonPath.DISCARD });
    const evaluationMap = new sfn.Map(this, 'EvaluatingMap', {
      itemsPath: '$.pairIds', maxConcurrency: MAP_CONCURRENCY, resultPath: sfn.JsonPath.DISCARD,
      itemSelector: { 'runId.$': '$.runId', 'pairId.$': '$$.Map.Item.Value' },
    }).itemProcessor(evaluationWorker);
    const finalize = invoke('FinalizeResult', finalizeResult, { 'runId.$': '$.runId' });
    const morePairs = new sfn.Choice(this, 'MorePairRefs?')
      .when(sfn.Condition.isPresent('$.nextCursor'), listNextPairRefs)
      .otherwise(finalize);

    setMatchingStatus.next(prepare).next(matchingMap).next(setEvaluatingStatus).next(listFirstPairRefs);
    listFirstPairRefs.next(evaluationMap).next(morePairs);
    listNextPairRefs.next(evaluationMap);
    for (const state of [setMatchingStatus, prepare, matchingMap]) state.addCatch(matchingFailure, { resultPath: sfn.JsonPath.DISCARD });
    for (const state of [setEvaluatingStatus, listFirstPairRefs, listNextPairRefs, evaluationMap]) state.addCatch(evaluatingFailure, { resultPath: sfn.JsonPath.DISCARD });
    finalize.addCatch(persistingFailure, { resultPath: sfn.JsonPath.DISCARD });

    const workflowLogs = new logs.LogGroup(this, 'RunStateMachineLogs', { retention: LOG_RETENTION, removalPolicy: RemovalPolicy.RETAIN });
    const runStateMachine = new sfn.StateMachine(this, 'RunStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(setMatchingStatus), tracingEnabled: true,
      logs: { destination: workflowLogs, level: sfn.LogLevel.ALL, includeExecutionData: false },
    });

    // The generated value remains only in Secrets Manager; no stack output exposes it.
    const apiKeySecret = new secretsmanager.Secret(this, 'ApiKeySecret', {
      description: 'Prototype shared API key for the Articulation Orchestrator API.',
      generateSecretString: { excludePunctuation: true, passwordLength: 48 },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const functionEnvironment = {
      ...workerEnvironment,
      STATE_MACHINE_ARN: runStateMachine.stateMachineArn,
      ORCHESTRATOR_LOCAL: props.local ? 'true' : 'false',
      ORCHESTRATOR_API_KEY_SECRET_ARN: apiKeySecret.secretArn,
    };
    const handler = new nodejs.NodejsFunction(this, 'ApiHandler', {
      entry: path.join(currentDirectory, '..', 'src', 'handlers', 'runs.ts'), handler: 'handler', runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512, timeout: Duration.seconds(30), logRetention: LOG_RETENTION, environment: functionEnvironment,
      bundling: { format: nodejs.OutputFormat.ESM, minify: true, sourceMap: true },
    });
    runs.grantReadWriteData(handler); runStateMachine.grantStartExecution(handler); results.grantReadData(handler); apiKeySecret.grantRead(handler);

    const refreshCatalogCache = new nodejs.NodejsFunction(this, 'RefreshCatalogCache', {
      entry: path.join(currentDirectory, '..', 'src', 'jobs', 'refresh-catalog-cache.ts'), handler: 'handler', runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512, timeout: Duration.minutes(5), logRetention: LOG_RETENTION, environment: functionEnvironment,
      bundling: { format: nodejs.OutputFormat.ESM, minify: true, sourceMap: true },
    });
    catalogTable.grantReadData(refreshCatalogCache); catalogCache.grantReadWriteData(refreshCatalogCache);
    new events.Rule(this, 'CatalogCacheRefreshSchedule', { schedule: events.Schedule.rate(Duration.minutes(15)), targets: [new eventsTargets.LambdaFunction(refreshCatalogCache)] });

    const api = new apigwv2.HttpApi(this, 'Api', {
      corsPreflight: {
        allowHeaders: ['content-type', 'x-api-key'],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowOrigins: ['*'],
      },
    });
    const integration = new integrations.HttpLambdaIntegration('ApiHandlerIntegration', handler);
    for (const [routePath, methods] of [
      ['/runs', [apigwv2.HttpMethod.POST]], ['/runs/{runId}', [apigwv2.HttpMethod.GET]], ['/runs/{runId}/result', [apigwv2.HttpMethod.GET]],
      ['/degree-programs', [apigwv2.HttpMethod.GET]], ['/degree-programs/{id}', [apigwv2.HttpMethod.GET]], ['/students', [apigwv2.HttpMethod.GET]],
      ['/students/{studentKey}/results', [apigwv2.HttpMethod.GET]], ['/results/{transcriptId}/{degreeProgramId}', [apigwv2.HttpMethod.GET]],
    ] as const) api.addRoutes({ path: routePath, methods: [...methods], integration });

    this.apiUrl = api.apiEndpoint;
    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'RunsTableName', { value: runs.tableName }); new CfnOutput(this, 'WorkTableName', { value: work.tableName });
    new CfnOutput(this, 'ResultsTableName', { value: results.tableName }); new CfnOutput(this, 'CatalogCacheTableName', { value: catalogCache.tableName });
  }
}
