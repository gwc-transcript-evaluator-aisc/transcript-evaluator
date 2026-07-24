import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, DockerImage, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
// packages/frontend-hosting/lib -> packages/frontend
const frontendDirectory = path.join(currentDirectory, '..', '..', 'frontend');

export interface FrontendHostingStackProps extends StackProps {
  /** Base URL of the transcript-processor HTTP API. Written to config.json at deploy time. */
  readonly transcriptApiBaseUrl?: string;
  /** Base URL of the articulation-orchestrator HTTP API. Written to config.json at deploy time. */
  readonly orchestratorApiBaseUrl?: string;
  /**
   * Test-only escape hatch. When false, the Vite build is skipped so the stack can be
   * synthesized without Node/asset bundling (used by unit tests).
   */
  readonly buildFrontend?: boolean;
}

export class FrontendHostingStack extends Stack {
  public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: FrontendHostingStackProps = {}) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // DEV SETTINGS: the bucket only holds a rebuildable static build, so it is safe to
      // destroy on stack deletion. Revisit for production if you add non-rebuildable assets.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Private bucket reachable only through CloudFront via Origin Access Control (OAC).
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      // SPA fallback: client-side routes resolve to index.html instead of S3 403/404.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    // Runtime config consumed by the app at startup (src/lib/runtimeConfig.ts). Using a
    // deploy-time config.json avoids baking the API URL into the Vite bundle, so the same
    // build works regardless of which API endpoint the backend stacks produce.
    const runtimeConfig = s3deploy.Source.jsonData('config.json', {
      transcriptApiBaseUrl: props.transcriptApiBaseUrl ?? '',
      orchestratorApiBaseUrl: props.orchestratorApiBaseUrl ?? '',
    });

    const sources: s3deploy.ISource[] = [runtimeConfig];
    if (props.buildFrontend !== false) {
      sources.push(this.buildViteApp());
    }

    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources,
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    this.distributionDomainName = distribution.distributionDomainName;
    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
  }

  /**
   * Produce the built Vite site as a bundled asset. Prefers a local Node build (no Docker
   * required, reuses the hoisted workspace dependencies) and falls back to a container build.
   */
  private buildViteApp(): s3deploy.ISource {
    return s3deploy.Source.asset(frontendDirectory, {
      exclude: ['node_modules', 'dist', '.env', '.env.*', 'cdk.out'],
      bundling: {
        image: DockerImage.fromRegistry('public.ecr.aws/docker/library/node:20'),
        command: ['bash', '-c', 'npm ci && npm run build && cp -r dist/. /asset-output/'],
        local: {
          tryBundle(outputDirectory: string): boolean {
            try {
              childProcess.execSync('npm run build', { cwd: frontendDirectory, stdio: 'inherit' });
              fs.cpSync(path.join(frontendDirectory, 'dist'), outputDirectory, { recursive: true });
              return true;
            } catch {
              // Fall back to container bundling.
              return false;
            }
          },
        },
      },
    });
  }
}
