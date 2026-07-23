import { InvokeDataAutomationAsyncCommand } from '@aws-sdk/client-bedrock-data-automation-runtime';
import { bda } from '../aws/clients.js';
import { config, requireConfig } from '../config.js';
import { putTaskToken } from '../jobs/task-token-store.js';

export interface InvokePageInput {
  jobId: string;
  pageNumber: number;
  pageKey: string;
  taskToken: string;
}

/** Step Functions task (waitForTaskToken pattern): starts a single page's BDA invocation
 * with EventBridge notifications enabled, records which task token is waiting on that
 * invocation, and returns without a result. The state machine execution for this page
 * stays paused until bda-event-callback.ts resolves the matching invocation's
 * EventBridge event and calls SendTaskSuccess/SendTaskFailure -- there is no polling. */
export const handler = async (input: InvokePageInput): Promise<void> => {
  requireConfig(['INPUT_BUCKET_NAME', config.inputBucket], ['OUTPUT_BUCKET_NAME', config.outputBucket], ['BDA_PROJECT_ARN', config.projectArn], ['BDA_PROFILE_ARN', config.profileArn]);
  const { jobId, pageNumber, pageKey, taskToken } = input;

  const outputUri = `s3://${config.outputBucket}/bda/${jobId}/page-${pageNumber}/`;
  const response = await bda.send(new InvokeDataAutomationAsyncCommand({
    inputConfiguration: { s3Uri: `s3://${config.inputBucket}/${pageKey}` },
    outputConfiguration: { s3Uri: outputUri },
    dataAutomationConfiguration: { dataAutomationProjectArn: config.projectArn, stage: 'LIVE' },
    dataAutomationProfileArn: config.profileArn,
    notificationConfiguration: { eventBridgeConfiguration: { eventBridgeEnabled: true } },
  }));

  const invocationArn = response.invocationArn;
  if (!invocationArn) throw new Error(`BDA did not return an invocation ARN for page ${pageNumber}`);

  // BDA's own job_id (the UUID suffix of the invocation ARN) is the only correlation id
  // present in the EventBridge completion event, so that's the key the callback looks
  // this record up by.
  const invocationJobId = invocationArn.split('/').pop();
  if (!invocationJobId) throw new Error(`Could not extract job id from invocation ARN: ${invocationArn}`);

  await putTaskToken({ invocationJobId, taskToken, jobId, pageNumber });
  // Intentionally no return value: this Lambda's Step Functions task is configured with
  // waitForTaskToken, so the state stays open until the callback signals it.
};
