#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CourseCatalogApiStack } from '../packages/course-catalog-api/lib/course-catalog-api-stack.js';
import { ArticulationEvaluatorStack } from '../packages/articulation-evaluator/lib/articulation-evaluator-stack.js';
import { ArticulationOrchestratorStack } from '../packages/articulation-orchestrator/lib/articulation-orchestrator-stack.js';
import { TranscriptProcessorStack } from '../packages/transcript-processor/lib/transcript-processor-stack.js';
import { FrontendHostingStack } from '../packages/frontend-hosting/lib/frontend-hosting-stack.js';

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

// The BDA blueprint and project are created and published to LIVE out of band
// (see transcript-processor-stack.ts). Their ARNs must be supplied via CDK context
// (-c bdaBlueprintArn=... -c bdaProjectArn=...) or the BDA_BLUEPRINT_ARN /
// BDA_PROJECT_ARN environment variables.
const requiredArn = (contextKey: string, envKey: string): string => {
  const value = app.node.tryGetContext(contextKey) ?? process.env[envKey];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing ${contextKey}. Supply the manually configured LIVE BDA resource ARN via '-c ${contextKey}=...' or the ${envKey} environment variable.`);
  }
  return value;
};

const transcriptProcessorStack = new TranscriptProcessorStack(app, 'TranscriptProcessorStack', {
  env,
  allowedOrigins: (app.node.tryGetContext('transcriptAllowedOrigins') ?? process.env.TRANSCRIPT_ALLOWED_ORIGINS ?? '*').split(','),
  bdaBlueprintArn: requiredArn('bdaBlueprintArn', 'BDA_BLUEPRINT_ARN'),
  bdaProjectArn: requiredArn('bdaProjectArn', 'BDA_PROJECT_ARN'),
});

const articulationOrchestratorStack = new ArticulationOrchestratorStack(app, 'ArticulationOrchestratorStack', {
  env,
  // This deployment is an end-to-end prototype: keep the browser path usable
  // without retrieving and embedding a shared Secrets Manager API key.
  local: true,
  bedrockModelId: app.node.tryGetContext('bedrockModelId') ?? process.env.BEDROCK_MODEL_ID,
});
articulationOrchestratorStack.addDependency(courseCatalogApiStack);
articulationOrchestratorStack.addDependency(articulationEvaluatorStack);
// The orchestrator consumes the processor API export, so deploy it only after the
// processor stack has created the real HTTP API.
articulationOrchestratorStack.addDependency(transcriptProcessorStack);

// Static frontend (S3 + CloudFront). The backend API URLs are written into config.json
// at deploy time, so the Vite build is decoupled from any specific API endpoint.
const frontendHostingStack = new FrontendHostingStack(app, 'FrontendHostingStack', {
  env,
  transcriptApiBaseUrl: transcriptProcessorStack.apiUrl,
  orchestratorApiBaseUrl: articulationOrchestratorStack.apiUrl,
});
// Depends on both APIs so their endpoints resolve before config.json is written.
frontendHostingStack.addDependency(transcriptProcessorStack);
frontendHostingStack.addDependency(articulationOrchestratorStack);
