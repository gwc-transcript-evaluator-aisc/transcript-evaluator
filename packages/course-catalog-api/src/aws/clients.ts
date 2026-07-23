import { BedrockDataAutomationRuntimeClient } from '@aws-sdk/client-bedrock-data-automation-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SFNClient } from '@aws-sdk/client-sfn';

export const s3 = new S3Client({});
export const dynamo = new DynamoDBClient({});
export const bda = new BedrockDataAutomationRuntimeClient({});
export const sfn = new SFNClient({});
