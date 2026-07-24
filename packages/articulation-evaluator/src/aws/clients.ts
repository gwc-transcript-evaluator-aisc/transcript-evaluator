import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

export const dynamo = new DynamoDBClient({});
export const bedrock = new BedrockRuntimeClient({ maxAttempts: 5, retryMode: 'adaptive' });
