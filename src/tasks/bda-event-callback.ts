import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient } from '@aws-sdk/client-sfn';
import { extractPageCoursesFromEventLocation } from '../domain/normalize.js';
import { deleteTaskToken, getTaskToken } from '../jobs/task-token-store.js';

const sfn = new SFNClient({});

/** Real BDA EventBridge event shape, confirmed against a live invocation (see
 * normalize.ts's extractPageCoursesFromEventLocation doc comment). Note the detail
 * fields are snake_case, unlike GetDataAutomationStatus's camelCase response. */
interface BdaEventBridgeEvent {
  'detail-type':
    | 'Bedrock Data Automation Job Created'
    | 'Bedrock Data Automation Job Succeeded'
    | 'Bedrock Data Automation Job Failed With Client Error'
    | 'Bedrock Data Automation Job Failed With Service Error';
  detail: {
    job_id: string;
    job_status: string;
    output_s3_location?: { s3_bucket: string; name: string };
    error_message?: string;
  };
}

/** EventBridge target for the rule matching aws.bedrock Job Succeeded/Failed events.
 * Looks up which Step Functions task token is waiting on this invocation (see
 * invoke-page-task.ts) and resolves it -- this is what lets the state machine proceed
 * without ever polling BDA. "Job Created" events are ignored; they're not terminal. */
export const handler = async (event: BdaEventBridgeEvent): Promise<void> => {
  if (event['detail-type'] === 'Bedrock Data Automation Job Created') return;

  const { job_id: invocationJobId, output_s3_location, error_message } = event.detail;
  const pending = await getTaskToken(invocationJobId);
  if (!pending) {
    // No matching task token: either this event is for an invocation this stack didn't
    // start (unlikely, but the event bus is account-wide), or the token already expired.
    // Nothing to signal; log and move on rather than throwing, since EventBridge would
    // otherwise retry a callback that can never succeed.
    console.warn(`No pending task token for BDA invocation ${invocationJobId}; ignoring event`);
    return;
  }

  try {
    if (event['detail-type'] === 'Bedrock Data Automation Job Succeeded') {
      const catalog = await extractPageCoursesFromEventLocation(
        output_s3_location ? { bucket: output_s3_location.s3_bucket, name: output_s3_location.name } : undefined,
      );
      const courses = catalog.courses.map((course) => ({ ...course, sourcePages: [pending.pageNumber] }));
      await sfn.send(new SendTaskSuccessCommand({
        taskToken: pending.taskToken,
        output: JSON.stringify({
          jobId: pending.jobId,
          pageNumber: pending.pageNumber,
          institution: catalog.institution,
          catalogTitle: catalog.catalogTitle,
          catalogAcademicYear: catalog.catalogAcademicYear,
          courses,
        }),
      }));
    } else {
      await sfn.send(new SendTaskFailureCommand({
        taskToken: pending.taskToken,
        error: event['detail-type'],
        cause: error_message || 'BDA processing failed',
      }));
    }
  } finally {
    await deleteTaskToken(invocationJobId);
  }
};
