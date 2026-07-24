import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ArticulationOrchestratorStack } from '../lib/articulation-orchestrator-stack.js';

const deploymentProps = {
  transcriptApiBaseUrl: 'https://transcripts.example.edu',
  bedrockModelId: 'anthropic.claude-test',
};

describe('ArticulationOrchestratorStack prototype API-key authentication', () => {
  it('generates a retained Secrets Manager key without exposing it in outputs', () => {
    const stack = new ArticulationOrchestratorStack(new App(), 'ApiKeyApi', deploymentProps);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({ ExcludePunctuation: true, PasswordLength: 48 }),
    });
    expect(JSON.stringify(template.toJSON().Outputs)).not.toContain('ApiKey');
    expect(JSON.stringify(template.toJSON())).not.toContain('Cognito');
  });

  it('allows x-api-key through CORS and grants only the API handler secret read access', () => {
    const stack = new ArticulationOrchestratorStack(new App(), 'ApiKeyProtectedApi', deploymentProps);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 0);
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({ AllowHeaders: Match.arrayWith(['x-api-key']) }),
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({ Action: Match.arrayWith(['secretsmanager:GetSecretValue']), Effect: 'Allow' })]),
      }),
    });
    for (const route of Object.values(template.findResources('AWS::ApiGatewayV2::Route'))) {
      expect(route.Properties.AuthorizationType).toBe('NONE');
    }
  });

  it('preserves explicit local API-key bypass behavior in the function environment', () => {
    const stack = new ArticulationOrchestratorStack(new App(), 'LocalApi', { ...deploymentProps, local: true });
    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ ORCHESTRATOR_LOCAL: 'true' }) },
    });
  });
});
