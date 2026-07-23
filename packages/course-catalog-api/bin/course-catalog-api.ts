#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CourseCatalogApiStack } from '../lib/course-catalog-api-stack.js';

const app = new cdk.App();
new CourseCatalogApiStack(app, 'CourseCatalogApiStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' },
});
