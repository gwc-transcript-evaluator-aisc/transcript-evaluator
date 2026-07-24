import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { TranscriptProcessorStack } from '../lib/transcript-processor-stack.js';

describe('TranscriptProcessorStack', () => {
  const synthesize = () => {
    const app = new cdk.App();
    return Template.fromStack(new TranscriptProcessorStack(app, 'TranscriptProcessorTest', {
      bundleDependencies: false,
      allowedOrigins: ['https://app.example.edu'],
      bdaBlueprintArn: 'arn:aws:bedrock:us-west-2:111111111111:blueprint/student-transcript-blueprint',
      bdaProjectArn: 'arn:aws:bedrock:us-west-2:111111111111:data-automation-project/student-transcript-processor',
    }));
  };

  it('creates encrypted retained S3 storage and encrypted dead-letter handling', () => {
    const template = synthesize();
    template.resourceCountIs('AWS::S3::Bucket', 2);
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
    });
    template.hasResourceProperties('Custom::S3BucketNotifications', {
      NotificationConfiguration: { EventBridgeConfiguration: {} },
    });
    template.hasResourceProperties('AWS::SQS::Queue', { SqsManagedSseEnabled: true });
  });

  it('does not manage the BDA blueprint or project in CloudFormation; it references the LIVE ARNs', () => {
    const template = synthesize();
    template.resourceCountIs('AWS::Bedrock::Blueprint', 0);
    template.resourceCountIs('AWS::Bedrock::DataAutomationProject', 0);

    const serialized = JSON.stringify(template.toJSON());
    expect(serialized).toContain('arn:aws:bedrock:us-west-2:111111111111:data-automation-project/student-transcript-processor');
  });

  it('packages the two processor handlers with a database secret and maps every public API contract route', () => {
    const serialized = JSON.stringify(synthesize().toJSON());
    expect(serialized).toContain('lambda_upload.handler');
    expect(serialized).toContain('lambda_processor.handler');
    expect(serialized).toContain('DB_SECRET_ARN');
    expect(serialized).toContain('us.anthropic.claude-sonnet-5');
    expect(serialized).toContain('/upload');
    expect(serialized).toContain('/status/{transcript_id}');
    expect(serialized).toContain('/transcript/{transcript_id}');
    expect(serialized).toContain('/review/lock/{transcript_id}');
    expect(serialized).toContain('/catalogue/scrape-course');
    expect(serialized).toContain('BdaOutputCreated');
    expect(serialized).toContain('AWS::RDS::DBCluster');
  });
});
