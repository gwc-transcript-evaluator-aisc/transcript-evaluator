#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TranscriptProcessorStack } from '../lib/transcript-processor-stack.js';

const app = new cdk.App();

const requiredContext = (name: string): string => {
  const value = app.node.tryGetContext(name);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`CDK context '${name}' is required. Supply the ARN of the manually configured LIVE BDA resource.`);
  }
  return value;
};

new TranscriptProcessorStack(app, 'TranscriptProcessorStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
  },
  allowedOrigins: app.node.tryGetContext('allowedOrigins')?.split(',') ?? ['*'],
  bdaBlueprintArn: requiredContext('bdaBlueprintArn'),
  bdaProjectArn: requiredContext('bdaProjectArn'),
});
