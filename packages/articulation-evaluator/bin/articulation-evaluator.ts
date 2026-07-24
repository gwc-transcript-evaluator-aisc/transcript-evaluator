#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ArticulationEvaluatorStack } from '../lib/articulation-evaluator-stack.js';

const app = new cdk.App();
new ArticulationEvaluatorStack(app, 'ArticulationEvaluatorStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' },
});
