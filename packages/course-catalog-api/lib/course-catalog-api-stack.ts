import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

export class CourseCatalogApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const inputBucket = new s3.Bucket(this, 'InputBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(7) }],
      cors: [{ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: ['*'], allowedHeaders: ['*'], maxAge: 900 }],
    });
    const outputBucket = new s3.Bucket(this, 'OutputBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(7) }],
    });
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({ blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: false, restrictPublicBuckets: false }),
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    inputBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowBedrockDataAutomationRead',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('bedrock.amazonaws.com')],
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [inputBucket.bucketArn, inputBucket.arnForObjects('*')],
      conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
    }));
    outputBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowBedrockDataAutomationWrite',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('bedrock.amazonaws.com')],
      actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
      resources: [outputBucket.bucketArn, outputBucket.arnForObjects('*')],
      conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
    }));

    const blueprintSchema = fs.readFileSync(path.join(currentDirectory, '..', 'blueprints', 'course-catalog-schema.json'), 'utf8');
    const blueprint = new bedrock.CfnBlueprint(this, 'CourseCatalogBlueprint', {
      blueprintName: 'course-catalog-blueprint',
      type: 'DOCUMENT',
      schema: JSON.parse(blueprintSchema),
    });
    const project = new bedrock.CfnDataAutomationProject(this, 'CourseCatalogProject', {
      projectName: 'course-catalog-project',
      projectDescription: 'Extracts articulation-focused course data from school catalogs',
      standardOutputConfiguration: {
        document: {
          extraction: {
            granularity: { types: ['DOCUMENT'] },
            boundingBox: { state: 'DISABLED' },
          },
          generativeField: { state: 'DISABLED' },
        },
      },
      customOutputConfiguration: {
        blueprints: [{ blueprintArn: blueprint.attrBlueprintArn, blueprintStage: 'LIVE' }],
      },
      overrideConfiguration: {
        document: {
          splitter: { state: 'ENABLED' },
        },
      },
    });

    const jobs = new dynamodb.Table(this, 'Jobs', {
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'expiresAt',
    });

    // Single-table design driven by the app's two real access patterns, both point
    // lookups keyed by catalogId (institution + academic year):
    //   1. GetItem(PK=catalogId, SK=METADATA)        -- does this catalog exist?
    //   2. GetItem(PK=catalogId, SK=COURSE#<code>)   -- exact course details
    // A catalog's METADATA item and all of its course items share the same partition
    // key, so both patterns are a single GetItem with no scan or secondary index needed.
    const catalog = new dynamodb.Table(this, 'Catalog', {
      partitionKey: { name: 'catalogId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Correlates a BDA invocation (keyed by its own job_id, which the EventBridge
    // completion event carries) back to the Step Functions task token that's paused
    // waiting on it. This is what lets the state machine advance purely from BDA's
    // EventBridge notification instead of polling GetDataAutomationStatus. TTL is a
    // safety net; the callback deletes entries as soon as they're used.
    const taskTokens = new dynamodb.Table(this, 'TaskTokens', {
      partitionKey: { name: 'invocationJobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'expiresAt',
    });

    const env = {
      INPUT_BUCKET_NAME: inputBucket.bucketName,
      OUTPUT_BUCKET_NAME: outputBucket.bucketName,
      JOBS_TABLE_NAME: jobs.tableName,
      CATALOG_TABLE_NAME: catalog.tableName,
      TASK_TOKENS_TABLE_NAME: taskTokens.tableName,
      BDA_PROJECT_ARN: project.attrProjectArn,
      BDA_PROFILE_ARN: `arn:aws:bedrock:${this.region}:${this.account}:data-automation-profile/us.data-automation-v1`,
      MAX_UPLOAD_BYTES: '52428800',
    };
    const handler = (id: string, entry: string, overrides: { memorySize?: number; timeout?: Duration } = {}) => new nodejs.NodejsFunction(this, id, {
      entry: path.join(currentDirectory, '..', 'src', 'api', entry),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: overrides.memorySize ?? 512,
      timeout: overrides.timeout ?? Duration.seconds(30),
      environment: env,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        minify: true,
        sourceMap: true,
      },
    });

    const createJob = handler('CreateJob', 'create-job.ts');
    // Point-lookup endpoints (exact existence check / exact course lookup).
    const catalogStatus = handler('CatalogStatus', 'catalog-status.ts');
    const courseLookup = handler('CourseLookup', 'course-lookup.ts');
    // Browse-the-database endpoints (list all catalogs / list a catalog's courses).
    const catalogsList = handler('CatalogsList', 'catalogs.ts');
    const catalogCourses = handler('CatalogCourses', 'catalog-courses.ts');
    // Reads execution status for the job's status endpoint (thin read, no orchestration).
    const status = handler('Status', 'status.ts');

    // Step Functions task Lambdas. These replace the old complete-job.ts /
    // status.ts polling loop with an event-driven pipeline: split -> (invoke each page &
    // wait for BDA's EventBridge event, no polling) -> finalize.
    const tasksHandler = (id: string, entry: string, overrides: { memorySize?: number; timeout?: Duration } = {}) => new nodejs.NodejsFunction(this, id, {
      entry: path.join(currentDirectory, '..', 'src', 'tasks', entry),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: overrides.memorySize ?? 512,
      timeout: overrides.timeout ?? Duration.seconds(30),
      environment: env,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        minify: true,
        sourceMap: true,
      },
    });

    // Reads the uploaded PDF and splits it into per-page files in S3. Needs more time
    // and memory than the other tasks to hold the whole PDF in memory.
    const splitPdfTask = tasksHandler('SplitPdfTask', 'split-pdf-task.ts', { memorySize: 1024, timeout: Duration.minutes(2) });
    // Starts one page's BDA invocation and records the task token; never polls.
    const invokePageTask = tasksHandler('InvokePageTask', 'invoke-page-task.ts');
    // EventBridge target: resolves the task token waiting on a completed/failed invocation.
    const bdaEventCallback = tasksHandler('BdaEventCallback', 'bda-event-callback.ts', { timeout: Duration.seconds(60) });
    // Merges every page's results into the final catalog once the whole Map completes.
    const finalizeCatalogTask = tasksHandler('FinalizeCatalogTask', 'finalize-catalog-task.ts');

    inputBucket.grantPut(createJob);
    inputBucket.grantReadWrite(splitPdfTask);
    inputBucket.grantRead(invokePageTask);
    inputBucket.grantRead(finalizeCatalogTask); // Read Step Functions DistributedMap results
    outputBucket.grantReadWrite(invokePageTask);
    outputBucket.grantRead(bdaEventCallback);
    jobs.grantReadWriteData(createJob);
    jobs.grantWriteData(finalizeCatalogTask);
    jobs.grantReadData(status);
    catalog.grantWriteData(finalizeCatalogTask);
    catalog.grantReadData(catalogStatus);
    catalog.grantReadData(courseLookup);
    catalog.grantReadData(catalogsList);
    catalog.grantReadData(catalogCourses);
    taskTokens.grantWriteData(invokePageTask);
    taskTokens.grantReadWriteData(bdaEventCallback);
    invokePageTask.addToRolePolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeDataAutomationAsync'], resources: ['*'] }));
    bdaEventCallback.addToRolePolicy(new iam.PolicyStatement({ actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'], resources: ['*'] }));

    // --- State machine: SplitPdf -> Map(InvokePage, wait for BDA's EventBridge event) -> FinalizeCatalog ---
    const splitPdfStep = new sfnTasks.LambdaInvoke(this, 'SplitPdf', {
      lambdaFunction: splitPdfTask,
      payload: sfn.TaskInput.fromObject({ jobId: sfn.JsonPath.stringAt('$.jobId'), inputKey: sfn.JsonPath.stringAt('$.inputKey') }),
      payloadResponseOnly: true,
      resultPath: '$.split',
    });

    const invokePageStep = new sfnTasks.LambdaInvoke(this, 'InvokePage', {
      lambdaFunction: invokePageTask,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      // $ here is the Map's itemSelector output for this iteration: {jobId, pageNumber, pageKey}.
      payload: sfn.TaskInput.fromObject({
        jobId: sfn.JsonPath.stringAt('$.jobId'),
        pageNumber: sfn.JsonPath.stringAt('$.pageNumber'),
        pageKey: sfn.JsonPath.stringAt('$.pageKey'),
        taskToken: sfn.JsonPath.taskToken,
      }),
    });
    // The state's output is normally whatever payload bda-event-callback.ts passed to
    // SendTaskSuccess (the page's extracted courses) -- no resultPath override, so that
    // becomes this iteration's result directly. If a page's BDA invocation fails, don't
    // let it fail the whole job: fall back to null so finalize still runs and produces a
    // best-effort catalog from whichever pages succeeded (mirrors the previous design's
    // "some pages failed" partial-success behavior).
    // BDA's concurrent-jobs quota is account-level (currently 25) and shared across every
    // page's InvokeDataAutomationAsync call fired by the Map below. A page that gets
    // rejected with ServiceQuotaExceededException because the quota was briefly exceeded
    // is a transient condition, not a real per-page failure -- retry it with backoff
    // before falling back to the permanent-failure Catch.
    invokePageStep.addRetry({
      errors: ['ServiceQuotaExceededException'],
      interval: Duration.seconds(10),
      maxAttempts: 6,
      backoffRate: 2,
    });
    invokePageStep.addCatch(new sfn.Pass(this, 'PageFailed', { result: sfn.Result.fromObject({ failed: true }) }), { resultPath: sfn.JsonPath.DISCARD });

    const processPagesStep = new sfn.DistributedMap(this, 'ProcessPages', {
      itemsPath: '$.split.pages',
      itemSelector: { jobId: sfn.JsonPath.stringAt('$.jobId'), pageNumber: sfn.JsonPath.stringAt('$$.Map.Item.Value.pageNumber'), pageKey: sfn.JsonPath.stringAt('$$.Map.Item.Value.pageKey') },
      // Kept below BDA's account-level concurrent-jobs quota (25) so pages don't get
      // rejected with ServiceQuotaExceededException out of the gate on large documents.
      maxConcurrency: 20,
      resultPath: '$.pageResults',
      resultWriter: new sfn.ResultWriter({
        bucket: inputBucket,
        prefix: 'step-functions-results',
      }),
    }).itemProcessor(invokePageStep);

    const finalizeCatalogStep = new sfnTasks.LambdaInvoke(this, 'FinalizeCatalog', {
      lambdaFunction: finalizeCatalogTask,
      payload: sfn.TaskInput.fromObject({
        jobId: sfn.JsonPath.stringAt('$.jobId'),
        catalogId: sfn.JsonPath.stringAt('$.catalogId'),
        pageResults: sfn.JsonPath.stringAt('$.pageResults'),
      }),
      payloadResponseOnly: true,
    });

    const stateMachine = new sfn.StateMachine(this, 'CatalogExtractionStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(splitPdfStep.next(processPagesStep).next(finalizeCatalogStep)),
      timeout: Duration.hours(2),
    });

    // The EventBridge rule that replaces polling: whenever BDA finishes any invocation
    // (this account/region-wide -- BDA doesn't support scoping the event to a specific
    // project), the callback Lambda looks up whether it's one of ours via the
    // TaskTokens table and resolves the matching task token if so.
    const bdaJobStateChangeRule = new events.Rule(this, 'BdaJobStateChangeRule', {
      eventPattern: {
        source: ['aws.bedrock'],
        detailType: [
          'Bedrock Data Automation Job Succeeded',
          'Bedrock Data Automation Job Failed With Client Error',
          'Bedrock Data Automation Job Failed With Service Error',
        ],
      },
    });
    bdaJobStateChangeRule.addTarget(new eventsTargets.LambdaFunction(bdaEventCallback));

    const api = new apigwv2.HttpApi(this, 'Api', {
      corsPreflight: { allowOrigins: ['*'], allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS], allowHeaders: ['content-type'] },
    });
    const completeJob = handler('CompleteJob', 'complete-job.ts');
    inputBucket.grantRead(completeJob);
    jobs.grantReadWriteData(completeJob);
    catalog.grantWriteData(completeJob);
    stateMachine.grantStartExecution(completeJob);
    completeJob.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);
    // Executions of a state machine live under a separate `execution:` ARN namespace
    // (not a suffix of the stateMachine: ARN), so this has to be built explicitly rather
    // than string-munging stateMachineArn -- CDK's ARN is a deploy-time token, and a
    // naive .replace() on it silently no-ops instead of throwing.
    status.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:DescribeExecution'],
      resources: [this.formatArn({ service: 'states', resource: 'execution', resourceName: `${stateMachine.stateMachineName}:*`, arnFormat: ArnFormat.COLON_RESOURCE_NAME })],
    }));

    api.addRoutes({ path: '/jobs', methods: [apigwv2.HttpMethod.POST], integration: new integrations.HttpLambdaIntegration('CreateJobIntegration', createJob) });
    api.addRoutes({ path: '/jobs/{jobId}/complete', methods: [apigwv2.HttpMethod.POST], integration: new integrations.HttpLambdaIntegration('CompleteJobIntegration', completeJob) });
    api.addRoutes({ path: '/jobs/{jobId}', methods: [apigwv2.HttpMethod.GET], integration: new integrations.HttpLambdaIntegration('StatusIntegration', status) });
    // Exact existence check and exact course lookup.
    api.addRoutes({ path: '/catalogs/{institution}/{academicYear}', methods: [apigwv2.HttpMethod.GET], integration: new integrations.HttpLambdaIntegration('CatalogStatusIntegration', catalogStatus) });
    api.addRoutes({ path: '/catalogs/{institution}/{academicYear}/courses/{courseCode}', methods: [apigwv2.HttpMethod.GET], integration: new integrations.HttpLambdaIntegration('CourseLookupIntegration', courseLookup) });
    // Browse-the-database list views for the frontend.
    api.addRoutes({ path: '/db/catalogs', methods: [apigwv2.HttpMethod.GET], integration: new integrations.HttpLambdaIntegration('CatalogsListIntegration', catalogsList) });
    api.addRoutes({ path: '/db/catalogs/{catalogId}/courses', methods: [apigwv2.HttpMethod.GET], integration: new integrations.HttpLambdaIntegration('CatalogCoursesIntegration', catalogCourses) });
    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'WebsiteUrl', { value: websiteBucket.bucketWebsiteUrl });
    new CfnOutput(this, 'WebsiteBucketName', { value: websiteBucket.bucketName });
    // Exported so other stacks (e.g. articulation-evaluator) can do read-only
    // cross-stack lookups against this table via Fn.importValue + Table.fromTableArn,
    // without this stack needing to know about them.
    new CfnOutput(this, 'CatalogTableArn', { value: catalog.tableArn, exportName: 'CourseCatalogApiStack-CatalogTableArn' });
    new CfnOutput(this, 'CatalogTableName', { value: catalog.tableName, exportName: 'CourseCatalogApiStack-CatalogTableName' });

    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [
        s3deploy.Source.asset(path.join(currentDirectory, '..', 'frontend')),
        s3deploy.Source.data('config.js', `window.COURSE_CATALOG_CONFIG = { apiBaseUrl: ${JSON.stringify(api.apiEndpoint)} };\n`),
      ],
      destinationBucket: websiteBucket,
      prune: true,
    });
  }
}
