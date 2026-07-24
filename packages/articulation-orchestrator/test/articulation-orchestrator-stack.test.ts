import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ArticulationOrchestratorStack } from '../lib/articulation-orchestrator-stack.js';

describe('ArticulationOrchestratorStack', () => {
  it('creates retained encrypted PITR tables and the student result index', () => {
    const app = new cdk.App();
    const stack = new ArticulationOrchestratorStack(app, 'TestStack', { local: true });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::DynamoDB::Table', 4);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      SSESpecification: { SSEEnabled: true },
      GlobalSecondaryIndexes: [{ IndexName: 'byStudent' }],
    });
    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(15 minutes)' });
  });

  it('defines a traced, logged, bounded workflow with paged evaluation references', () => {
    const app = new cdk.App();
    const stack = new ArticulationOrchestratorStack(app, 'WorkflowStack', { local: true });
    const serialized = JSON.stringify(Template.fromStack(stack).toJSON());

    expect(serialized).toContain('SetMatchingStatus');
    expect(serialized).toContain('PrepareRunTask');
    expect(serialized).toContain('MatchingMap');
    expect(serialized).toContain('SetEvaluatingStatus');
    expect(serialized).toContain('ListPairRefs');
    expect(serialized).toContain('EvaluatingMap');
    expect(serialized).toContain('FinalizeResult');
    expect(serialized).toContain('MatchingFailed');
    expect(serialized).toContain('EvaluatingFailed');
    expect(serialized).toContain('PersistingFailed');
    expect(serialized).toContain('MaxConcurrency');
    expect(serialized).toContain('nextCursor');
    expect(serialized).toContain('ResultPath');
    expect(serialized).toContain('Retry');
    expect(serialized).toContain('TracingConfiguration');
    expect(serialized).toContain('LoggingConfiguration');
    expect(serialized).toContain('lambda:InvokeFunction');
    expect(serialized).toContain('ArticulationEvaluatorStack-EvaluateArticulationArn');
  });

  it('creates generated shared API-key infrastructure for non-local deployment', () => {
    const stack = new ArticulationOrchestratorStack(new cdk.App(), 'ProtectedStack');
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 0);
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
  });
});
