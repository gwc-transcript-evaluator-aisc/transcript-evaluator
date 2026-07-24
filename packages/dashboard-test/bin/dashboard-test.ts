#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DashboardTestStack } from '../lib/dashboard-test-stack.js';

const app = new cdk.App();

new DashboardTestStack(app, 'DashboardTestStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2' },
});
