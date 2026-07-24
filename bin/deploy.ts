#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CourseCatalogApiStack } from '../packages/course-catalog-api/lib/course-catalog-api-stack.js';
import { ArticulationEvaluatorStack } from '../packages/articulation-evaluator/lib/articulation-evaluator-stack.js';

// Single CDK app aggregating every package's stack, so `cdk deploy --all` (or
// `npm run deploy` from the repo root) deploys everything in one command as new
// packages are added, rather than running `cdk deploy` separately inside each
// package. Stacks stay independently deployable/rollback-able -- this just gives
// them one shared entry point. Stack ids are kept identical to each package's
// standalone bin/ entry point (e.g. 'CourseCatalogApiStack') so CDK maps onto the
// already-deployed CloudFormation stacks instead of creating duplicates.
const app = new cdk.App();

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2' };

const courseCatalogApiStack = new CourseCatalogApiStack(app, 'CourseCatalogApiStack', { env });

// Reads course-catalog-api's Catalog table via a cross-stack CfnOutput/Fn.importValue
// (see course-catalog-api-stack.ts's exports), so it must deploy after that stack --
// this explicit dependency makes `cdk deploy --all` order them correctly rather than
// relying on CloudFormation import-value resolution alone.
const articulationEvaluatorStack = new ArticulationEvaluatorStack(app, 'ArticulationEvaluatorStack', { env });
articulationEvaluatorStack.addDependency(courseCatalogApiStack);

// Add future package stacks here.
