#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ArticulationOrchestratorStack } from '../lib/articulation-orchestrator-stack.js';

const app = new cdk.App();
const localContext = app.node.tryGetContext('local');
new ArticulationOrchestratorStack(app, 'ArticulationOrchestratorStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2' },
  local: localContext === true || localContext === 'true',
  // The root app supplies the TranscriptProcessorStack export. This override remains
  // only for independently synthesized stacks that intentionally use another API.
  transcriptApiBaseUrl: app.node.tryGetContext('transcriptApiBaseUrl'),
  bedrockModelId: app.node.tryGetContext('bedrockModelId') ?? process.env.BEDROCK_MODEL_ID,
});
