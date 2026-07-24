import { randomUUID } from 'node:crypto';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { loadConfig } from '../config.js';
import { dynamo, secretsManager, stepFunctions } from '../aws/clients.js';
import { requireApiKey } from '../api/auth.js';
import { attachCorrelationId, logServerFailure, publicError, toPublicError, type ApiResponse } from '../api/http.js';
import { createRun, getRunStatus } from '../api/runs.js';
import { getLatestResult, getRunResult, listStudentResults, listStudents } from '../api/results.js';
import { getDegreeProgram, listDegreePrograms } from '../degree-programs/registry-service.js';
import { RunsStore } from '../store/runs-store.js';
import { ResultsStore } from '../store/results-store.js';
import { TranscriptClient } from '../transcript/transcript-client.js';

const API_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedApiKey: { value: string; expiresAt: number } | undefined;

async function readApiKey(secretArn: string): Promise<string | undefined> {
  if (cachedApiKey?.expiresAt && cachedApiKey.expiresAt > Date.now()) return cachedApiKey.value;
  const response = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const value = response.SecretString?.trim();
  if (!value) return undefined;
  cachedApiKey = { value, expiresAt: Date.now() + API_KEY_CACHE_TTL_MS };
  return value;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const correlationId = event.headers['x-correlation-id']?.trim() || randomUUID();
  const method = event.requestContext.http.method;
  const route = event.rawPath;
  try {
    const config = loadConfig();
    await requireApiKey(event, process.env.ORCHESTRATOR_LOCAL === 'true', config.orchestratorApiKeySecretArn, { read: readApiKey });
    const response = await routeRequest(event, config);
    return serialize(attachCorrelationId(response, correlationId), correlationId);
  } catch (error) {
    logServerFailure(error, correlationId, route, method);
    return serialize(toPublicError(error, correlationId), correlationId);
  }
};

async function routeRequest(event: Parameters<APIGatewayProxyHandlerV2>[0], config = loadConfig()): Promise<ApiResponse> {
  const runs = new RunsStore(dynamo, config.runsTableName);
  const results = new ResultsStore(dynamo, config.resultsTableName, config.runsTableName);
  const transcript = new TranscriptClient({ baseUrl: config.transcriptApiBaseUrl, authToken: config.transcriptApiAuthToken });
  const method = event.requestContext.http.method;
  const query = event.queryStringParameters ?? {};

  if (method === 'POST' && event.rawPath === '/runs') {
    let body: unknown;
    try { body = event.body ? JSON.parse(event.body) : undefined; } catch { body = undefined; }
    return createRun(body, { runs, transcripts: transcript, stepFunctions, stateMachineArn: config.stateMachineArn });
  }
  if (method === 'GET' && event.rawPath === '/degree-programs') return { statusCode: 200, body: listDegreePrograms() };
  if (method === 'GET' && event.rawPath.startsWith('/degree-programs/') && event.pathParameters?.id) {
    const lookup = getDegreeProgram(event.pathParameters.id);
    return lookup.kind === 'found'
      ? { statusCode: 200, body: lookup.program }
      : publicError(404, 'DEGREE_PROGRAM_NOT_FOUND', 'Degree program was not found.');
  }
  if (method === 'GET' && event.rawPath === '/students') return listStudents(query, results);
  if (method === 'GET' && event.pathParameters?.studentKey && event.rawPath.endsWith('/results')) return listStudentResults(event.pathParameters.studentKey, query, results);
  if (method === 'GET' && event.pathParameters?.transcriptId && event.pathParameters?.degreeProgramId) return getLatestResult(event.pathParameters.transcriptId, event.pathParameters.degreeProgramId, results);
  if (method === 'GET' && event.pathParameters?.runId && event.rawPath.endsWith('/result')) return getRunResult(event.pathParameters.runId, { runs, results });
  if (method === 'GET' && event.pathParameters?.runId) return getRunStatus(event.pathParameters.runId, runs);
  return publicError(404, 'ROUTE_NOT_FOUND', 'Route was not found.');
}

function serialize(response: ApiResponse, correlationId: string) {
  return {
    statusCode: response.statusCode,
    headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify(response.body),
  };
}
