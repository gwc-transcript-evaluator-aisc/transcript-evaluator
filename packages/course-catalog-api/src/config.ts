export const config = {
  inputBucket: process.env.INPUT_BUCKET_NAME ?? '',
  outputBucket: process.env.OUTPUT_BUCKET_NAME ?? '',
  jobsTable: process.env.JOBS_TABLE_NAME ?? '',
  blueprintArn: process.env.BDA_BLUEPRINT_ARN ?? '',
  projectArn: process.env.BDA_PROJECT_ARN ?? '',
  profileArn: process.env.BDA_PROFILE_ARN ?? '',
  stateMachineArn: process.env.STATE_MACHINE_ARN ?? '',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 52_428_800),
  uploadUrlTtlSeconds: 900,
};

export function requireConfig(...values: Array<[string, string]>): void {
  const missing = values.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Missing configuration: ${missing.join(', ')}`);
}
