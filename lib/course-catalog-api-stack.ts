import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
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

    // Interim per-page extraction results while a job is still processing. The final
    // catalogId isn't known until all pages resolve (it's derived from extracted
    // institution/academic year), so pages land here first and get merged into Courses
    // once the whole job completes. TTL cleans these up automatically.
    const pageExtractions = new dynamodb.Table(this, 'PageExtractions', {
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'pageNumber', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'expiresAt',
    });

    const env = {
      INPUT_BUCKET_NAME: inputBucket.bucketName,
      OUTPUT_BUCKET_NAME: outputBucket.bucketName,
      JOBS_TABLE_NAME: jobs.tableName,
      CATALOG_TABLE_NAME: catalog.tableName,
      PAGE_EXTRACTIONS_TABLE_NAME: pageExtractions.tableName,
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
      depsLockFilePath: path.join(currentDirectory, '..', 'package-lock.json'),
      environment: env,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        minify: true,
        sourceMap: true,
        nodeModules: [
          '@aws-sdk/client-bedrock-data-automation-runtime',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/client-s3',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/s3-request-presigner',
          'pdf-lib',
        ],
      },
    });

    const createJob = handler('CreateJob', 'create-job.ts');
    // Splits the uploaded PDF into pages and invokes BDA once per page; needs more time
    // and memory than the other handlers to hold the PDF and fan out invocations.
    const completeJob = handler('CompleteJob', 'complete-job.ts', { memorySize: 1024, timeout: Duration.minutes(5) });
    // Polls potentially hundreds of per-page BDA invocations and merges results on completion.
    const status = handler('Status', 'status.ts', { memorySize: 512, timeout: Duration.minutes(2) });
    // Point-lookup endpoints (exact existence check / exact course lookup).
    const catalogStatus = handler('CatalogStatus', 'catalog-status.ts');
    const courseLookup = handler('CourseLookup', 'course-lookup.ts');
    // Browse-the-database endpoints (list all catalogs / list a catalog's courses).
    const catalogsList = handler('CatalogsList', 'catalogs.ts');
    const catalogCourses = handler('CatalogCourses', 'catalog-courses.ts');

    inputBucket.grantPut(createJob);
    inputBucket.grantReadWrite(completeJob);
    outputBucket.grantReadWrite(completeJob);
    outputBucket.grantRead(status);
    jobs.grantReadWriteData(createJob);
    jobs.grantReadWriteData(completeJob);
    jobs.grantReadWriteData(status);
    catalog.grantWriteData(completeJob);
    catalog.grantReadWriteData(status);
    catalog.grantReadData(catalogStatus);
    catalog.grantReadData(courseLookup);
    catalog.grantReadData(catalogsList);
    catalog.grantReadData(catalogCourses);
    pageExtractions.grantReadWriteData(status);
    completeJob.addToRolePolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeDataAutomationAsync'], resources: ['*'] }));
    status.addToRolePolicy(new iam.PolicyStatement({ actions: ['bedrock:GetDataAutomationStatus'], resources: ['*'] }));

    const api = new apigwv2.HttpApi(this, 'Api', {
      corsPreflight: { allowOrigins: ['*'], allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS], allowHeaders: ['content-type'] },
    });
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
