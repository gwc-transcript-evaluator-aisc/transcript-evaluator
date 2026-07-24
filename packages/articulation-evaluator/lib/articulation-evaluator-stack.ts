import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, Fn, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

/** Cross-region inference profile id for Claude Sonnet 5. Overridable via the
 * BEDROCK_MODEL_ID env var on the function without a redeploy of this stack. */
const DEFAULT_BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-5';

export class ArticulationEvaluatorStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Read-only reference to course-catalog-api's Catalog table, imported via the
    // CfnOutput it exports (see course-catalog-api-stack.ts). This stack never creates
    // or owns that table -- course-catalog-api's stack must be deployed first.
    const catalogTableArn = Fn.importValue('CourseCatalogApiStack-CatalogTableArn');
    const catalogTable = dynamodb.Table.fromTableArn(this, 'CatalogTable', catalogTableArn);

    // Append-only evaluation history. Primary key is a generated evaluationId (every
    // invocation writes a new item); pairKey is a plain attribute (not indexed by a GSI
    // yet) that lets a future lookup find prior evaluations of the same course pair by
    // Scan+filter. Add a GSI on pairKey if that lookup needs to be a real access pattern
    // later -- not needed for this Lambda's own read/write path today.
    const evaluations = new dynamodb.Table(this, 'Evaluations', {
      partitionKey: { name: 'evaluationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    const evaluateArticulation = new nodejs.NodejsFunction(this, 'EvaluateArticulation', {
      entry: path.join(currentDirectory, '..', 'src', 'handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      // Generous headroom for a Bedrock Converse call plus two point-reads.
      timeout: Duration.seconds(60),
      environment: {
        CATALOG_TABLE_NAME: catalogTable.tableName,
        EVALUATIONS_TABLE_NAME: evaluations.tableName,
        BEDROCK_MODEL_ID: DEFAULT_BEDROCK_MODEL_ID,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        minify: true,
        sourceMap: true,
        // Lets articulation-assessor.ts `import` the Cal-GETC standards markdown
        // directly as inlined text (see src/ai/context/markdown-modules.d.ts).
        loader: { '.md': 'text' },
      },
    });

    catalogTable.grantReadData(evaluateArticulation);
    evaluations.grantWriteData(evaluateArticulation);
    evaluateArticulation.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      // Converse against a cross-region inference profile invokes the underlying
      // foundation model in whichever region it routes to, so the resource has to cover
      // both the inference-profile ARN and the on-demand foundation-model ARN pattern,
      // not just this stack's own region/account.
      resources: [
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
        `arn:aws:bedrock:*::foundation-model/*`,
      ],
    }));

    // Exported so other stacks (e.g. a thin API wrapper) can invoke this
    // direct-invoke-only Lambda without this stack needing to know about them.
    new CfnOutput(this, 'EvaluateArticulationFunctionArn', { value: evaluateArticulation.functionArn, exportName: 'ArticulationEvaluatorStack-EvaluateArticulationArn' });
  }
}
