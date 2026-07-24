import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const processorDirectory = path.join(currentDirectory, '..');
const BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-5';
const LOG_RETENTION = logs.RetentionDays.ONE_MONTH;

export interface TranscriptProcessorStackProps extends StackProps {
  /** ARN of the manually created student-transcript-blueprint in the LIVE stage. */
  readonly bdaBlueprintArn: string;
  /** ARN of the existing BDA project whose configuration already attaches the LIVE blueprint. */
  readonly bdaProjectArn: string;
  /** CORS origins for the existing browser contract. Authentication is intentionally not added here. */
  readonly allowedOrigins?: string[];
  /** Test-only escape hatch that prevents asset dependency installation during unit tests. */
  readonly bundleDependencies?: boolean;
}

export class TranscriptProcessorStack extends Stack {
  /** Base URL of the HTTP API, consumed by the frontend-hosting stack. */
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: TranscriptProcessorStackProps) {
    super(scope, id, props);

    const inputBucket = new s3.Bucket(this, 'InputBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ expiration: Duration.days(30), noncurrentVersionExpiration: Duration.days(7) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const outputBucket = new s3.Bucket(this, 'OutputBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      eventBridgeEnabled: true,
      lifecycleRules: [{ expiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // The BDA API create request publishes this blueprint directly to LIVE, but
    // AWS::Bedrock::Blueprint exposes BlueprintStage only as a read-only attribute.
    // CloudFormation also cannot read an existing project and append an attachment
    // while preserving its current standard/custom output configuration. Use only
    // the manually created LIVE blueprint and the project it is already attached to.
    if (props.bdaBlueprintArn.trim().length === 0 || props.bdaProjectArn.trim().length === 0) {
      throw new Error('bdaBlueprintArn and bdaProjectArn must reference the manually configured LIVE BDA blueprint and project.');
    }
    const bdaBlueprintArn = props.bdaBlueprintArn;
    const bdaProjectArn = props.bdaProjectArn;

    const vpc = new ec2.Vpc(this, 'ProcessorVpc', { maxAzs: 2, natGateways: 1 });
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', { vpc, allowAllOutbound: true, description: 'Transcript processor Lambda egress' });
    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', { vpc, description: 'Transcript processor database access' });
    databaseSecurityGroup.addIngressRule(lambdaSecurityGroup, ec2.Port.tcp(5432), 'Processor Lambda PostgreSQL access');
    const database = new rds.DatabaseCluster(this, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_8 }),
      writer: rds.ClusterInstance.serverlessV2('writer'),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      credentials: rds.Credentials.fromGeneratedSecret('transcript_processor'),
      defaultDatabaseName: 'transcripts',
      vpc,
      securityGroups: [databaseSecurityGroup],
      storageEncrypted: true,
      backup: { retention: Duration.days(7) },
      // DEV SETTINGS: fast, unblockable teardown while the stack is still being
      // brought up. Before production, restore RemovalPolicy.SNAPSHOT and
      // deletionProtection: true so the database cannot be destroyed accidentally.
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    const assetExcludes = ['bin', 'lib', 'test', 'blueprints', 'cdk.out', 'node_modules', '*.html', 'generate_transcripts.py', 'deploy.sh', 'deploy_local.ps1'];
    // Docker produces the deploy artifact. The equivalent local path makes synthesis
    // possible on developer machines without Docker while still resolving Linux x86_64
    // wheels compatible with the configured Python 3.12 Lambda runtime.
    const pythonBundling = {
      image: lambda.Runtime.PYTHON_3_12.bundlingImage,
      command: ['bash', '-c', 'pip install --no-cache-dir -r requirements.txt -t /asset-output && cp *.py /asset-output/'],
      local: {
        tryBundle(outputDir: string): boolean {
          childProcess.execFileSync('python3', [
            '-m', 'pip', 'install', '--no-cache-dir', '--only-binary=:all:',
            '--platform', 'manylinux2014_x86_64', '--implementation', 'cp', '--python-version', '3.12',
            '--target', outputDir, '-r', 'requirements.txt',
          ], { cwd: processorDirectory, stdio: 'inherit' });
          for (const entry of fs.readdirSync(processorDirectory).filter((name) => name.endsWith('.py'))) {
            fs.copyFileSync(path.join(processorDirectory, entry), path.join(outputDir, entry));
          }
          return true;
        },
      },
    };
    const code = lambda.Code.fromAsset(processorDirectory, props.bundleDependencies === false
      ? { exclude: assetExcludes }
      : { exclude: assetExcludes, bundling: pythonBundling });
    const sharedEnvironment = {
      S3_BUCKET_INPUT: inputBucket.bucketName,
      S3_BUCKET_OUTPUT: outputBucket.bucketName,
      S3_INPUT_PREFIX: 'transcripts/',
      S3_OUTPUT_PREFIX: 'bda-output/',
      BDA_PROJECT_ARN: bdaProjectArn,
      BDA_BLUEPRINT_ARN: bdaBlueprintArn,
      BDA_PROJECT_NAME: 'student-transcript-processor',
      BDA_PROFILE_ARN: `arn:aws:bedrock:${this.region}:${this.account}:data-automation-profile/us.data-automation-v1`,
      DB_HOST: database.clusterEndpoint.hostname,
      DB_PORT: database.clusterEndpoint.port.toString(),
      DB_NAME: 'transcripts',
      DB_USER: 'transcript_processor',
      DB_SECRET_ARN: database.secret!.secretArn,
      BEDROCK_MODEL_ID,
    };
    const handler = (name: string, file: string, timeout: Duration) => new lambda.Function(this, name, {
      runtime: lambda.Runtime.PYTHON_3_12,
      code,
      handler: `${file}.handler`,
      timeout,
      memorySize: 1024,
      tracing: lambda.Tracing.ACTIVE,
      vpc,
      securityGroups: [lambdaSecurityGroup],
      environment: sharedEnvironment,
      logRetention: LOG_RETENTION,
    });
    const uploadHandler = handler('UploadHandler', 'lambda_upload', Duration.minutes(1));
    const resultProcessor = handler('ResultProcessor', 'lambda_processor', Duration.minutes(5));
    const databaseInitializer = handler('DatabaseInitializer', 'lambda_initialize', Duration.minutes(2));

    for (const fn of [uploadHandler, resultProcessor, databaseInitializer]) {
      inputBucket.grantReadWrite(fn);
      outputBucket.grantReadWrite(fn);
      database.secret!.grantRead(fn);
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [`arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`, 'arn:aws:bedrock:*::foundation-model/*'],
      }));
    }
    uploadHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeDataAutomationAsync'],
      // us.data-automation-v1 is a cross-region profile: BDA routes the job to a member
      // region (e.g. us-east-1) and IAM re-checks the profile ARN in that target region,
      // so the profile resource must span all regions, not just this stack's region.
      resources: [bdaProjectArn, `arn:aws:bedrock:*:${this.account}:data-automation-profile/us.data-automation-v1`],
    }));
    inputBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowBdaReadInput', effect: iam.Effect.ALLOW, principals: [new iam.ServicePrincipal('bedrock.amazonaws.com')],
      actions: ['s3:GetObject', 's3:ListBucket'], resources: [inputBucket.bucketArn, inputBucket.arnForObjects('*')],
      conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
    }));
    outputBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowBdaWriteOutput', effect: iam.Effect.ALLOW, principals: [new iam.ServicePrincipal('bedrock.amazonaws.com')],
      actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'], resources: [outputBucket.bucketArn, outputBucket.arnForObjects('*')],
      conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
    }));

    const processingDlq = new sqs.Queue(this, 'ProcessingDlq', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    new events.Rule(this, 'BdaOutputCreated', {
      eventPattern: { source: ['aws.s3'], detailType: ['Object Created'], detail: { bucket: { name: [outputBucket.bucketName] }, object: { key: [{ suffix: '.json' }] } } },
      targets: [new eventsTargets.LambdaFunction(resultProcessor, { deadLetterQueue: processingDlq, retryAttempts: 2, maxEventAge: Duration.hours(2) })],
    });

    const schemaInitialization = new cr.AwsCustomResource(this, 'SchemaInitialization', {
      onCreate: { service: 'Lambda', action: 'invoke', parameters: { FunctionName: databaseInitializer.functionName, InvocationType: 'RequestResponse', Payload: JSON.stringify({ RequestType: 'Create' }) }, physicalResourceId: cr.PhysicalResourceId.of('transcript-processor-schema') },
      onUpdate: { service: 'Lambda', action: 'invoke', parameters: { FunctionName: databaseInitializer.functionName, InvocationType: 'RequestResponse', Payload: JSON.stringify({ RequestType: 'Update' }) }, physicalResourceId: cr.PhysicalResourceId.of('transcript-processor-schema') },
      // fromSdkCalls derives the IAM action from the SDK call name ('invoke' ->
      // 'lambda:Invoke'), which is not a real IAM action. The Lambda invoke
      // permission must be granted explicitly as 'lambda:InvokeFunction'.
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['lambda:InvokeFunction'],
          resources: [databaseInitializer.functionArn],
        }),
      ]),
    });
    schemaInitialization.node.addDependency(database);

    const api = new apigwv2.HttpApi(this, 'Api', {
      corsPreflight: { allowOrigins: props.allowedOrigins ?? ['*'], allowHeaders: ['content-type'], allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.PUT, apigwv2.CorsHttpMethod.DELETE, apigwv2.CorsHttpMethod.OPTIONS] },
    });
    const apiIntegration = new integrations.HttpLambdaIntegration('ProcessorIntegration', uploadHandler);
    for (const [routePath, methods] of [
      ['/upload', [apigwv2.HttpMethod.POST]], ['/query', [apigwv2.HttpMethod.POST]], ['/status/{transcript_id}', [apigwv2.HttpMethod.GET]], ['/transcripts', [apigwv2.HttpMethod.GET]], ['/transcript/{transcript_id}', [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.DELETE]],
      ['/review/lock/{transcript_id}', [apigwv2.HttpMethod.POST]], ['/review/unlock/{transcript_id}', [apigwv2.HttpMethod.POST]], ['/review/verify/{transcript_id}', [apigwv2.HttpMethod.POST]], ['/review/flag/{transcript_id}', [apigwv2.HttpMethod.POST]],
      ['/student/{student_id}', [apigwv2.HttpMethod.PUT]], ['/student/{student_id}/courses', [apigwv2.HttpMethod.POST]], ['/course/{course_id}', [apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE]], ['/audit/{transcript_id}', [apigwv2.HttpMethod.GET]],
      ['/catalogue/institution', [apigwv2.HttpMethod.POST]], ['/catalogue/scrape/{transcript_id}', [apigwv2.HttpMethod.POST]], ['/catalogue/scrape-course', [apigwv2.HttpMethod.POST]], ['/catalogue/courses/{institution_id}', [apigwv2.HttpMethod.GET]],
    ] as const) api.addRoutes({ path: routePath, methods: [...methods], integration: apiIntegration });

    this.apiUrl = api.apiEndpoint;
    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint, exportName: 'TranscriptProcessorStack-ApiUrl' });
    new CfnOutput(this, 'InputBucketName', { value: inputBucket.bucketName });
    new CfnOutput(this, 'OutputBucketName', { value: outputBucket.bucketName });
    new CfnOutput(this, 'DatabaseSecretArn', { value: database.secret!.secretArn });
  }
}
