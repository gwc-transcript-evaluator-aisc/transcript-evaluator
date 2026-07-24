import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SFNClient } from '@aws-sdk/client-sfn';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ maxAttempts: 5, retryMode: 'adaptive' });

export const dynamo = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
export const bedrock = new BedrockRuntimeClient({ maxAttempts: 5, retryMode: 'adaptive' });
export const lambda = new LambdaClient({ maxAttempts: 5, retryMode: 'adaptive' });
export const secretsManager = new SecretsManagerClient({ maxAttempts: 5, retryMode: 'adaptive' });
export const stepFunctions = new SFNClient({ maxAttempts: 5, retryMode: 'adaptive' });
