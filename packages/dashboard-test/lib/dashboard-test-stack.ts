import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

/** TEMPORARY testing stack: a tiny public dashboard that lets you feed home/transfer
 * course details into articulation-evaluator's direct-invoke Lambda by hand and see the
 * result. No auth -- this is a throwaway prototype meant to be destroyed shortly, not a
 * durable public surface for the service. */
export class DashboardTestStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const evaluateArticulationArn = Fn.importValue('ArticulationEvaluatorStack-EvaluateArticulationArn');
    const evaluateArticulation = lambda.Function.fromFunctionAttributes(this, 'EvaluateArticulationFunction', {
      functionArn: evaluateArticulationArn,
      sameEnvironment: true,
    });

    const invokeEvaluation = new nodejs.NodejsFunction(this, 'InvokeEvaluation', {
      entry: path.join(currentDirectory, '..', 'src', 'invoke-evaluation.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(65),
      environment: {
        EVALUATE_ARTICULATION_FUNCTION_ARN: evaluateArticulation.functionArn,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        minify: true,
        sourceMap: true,
      },
    });
    evaluateArticulation.grantInvoke(invokeEvaluation);

    const api = new apigwv2.HttpApi(this, 'Api', {
      corsPreflight: { allowOrigins: ['*'], allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS], allowHeaders: ['content-type'] },
    });
    api.addRoutes({ path: '/evaluate', methods: [apigwv2.HttpMethod.POST], integration: new integrations.HttpLambdaIntegration('InvokeEvaluationIntegration', invokeEvaluation) });

    // Public static site -- no CloudFront, just a public S3 website bucket, matching the
    // throwaway nature of this stack. Destroy this stack when done testing.
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({ blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: false, restrictPublicBuckets: false }),
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [
        s3deploy.Source.asset(path.join(currentDirectory, '..', 'frontend')),
        s3deploy.Source.data('config.js', `window.DASHBOARD_CONFIG = { apiBaseUrl: ${JSON.stringify(api.apiEndpoint)} };\n`),
      ],
      destinationBucket: siteBucket,
      prune: true,
    });

    new CfnOutput(this, 'DashboardUrl', { value: siteBucket.bucketWebsiteUrl });
    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
  }
}
