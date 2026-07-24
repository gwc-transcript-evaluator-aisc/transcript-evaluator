import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

/** Temporary scaffold handler. Route-specific handlers replace this as API tasks are implemented. */
export const handler: APIGatewayProxyHandlerV2 = async () => ({
  statusCode: 501,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: 'NOT_IMPLEMENTED', message: 'This endpoint is not implemented yet.' }),
});
