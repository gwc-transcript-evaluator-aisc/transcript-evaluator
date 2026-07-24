#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { FrontendHostingStack } from '../lib/frontend-hosting-stack.js';

const app = new cdk.App();

// Standalone deploys read the API URLs from context or environment. The aggregate
// entry point (bin/deploy.ts) instead passes them directly from the backend stacks.
new FrontendHostingStack(app, 'FrontendHostingStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
  },
  transcriptApiBaseUrl: app.node.tryGetContext('transcriptApiBaseUrl') ?? process.env.TRANSCRIPT_API_BASE_URL,
  orchestratorApiBaseUrl: app.node.tryGetContext('orchestratorApiBaseUrl') ?? process.env.ORCHESTRATOR_API_BASE_URL,
});
