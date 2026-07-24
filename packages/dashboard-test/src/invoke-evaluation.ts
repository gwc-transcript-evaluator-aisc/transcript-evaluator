import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({});

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Thin passthrough: this dashboard has no business logic of its own -- it just accepts
 * the home/transfer course identifiers from the form and direct-invokes
 * articulation-evaluator's EvaluateArticulation Lambda (which isn't behind its own API
 * Gateway), then relays whatever it returns. TEMPORARY testing scaffold. */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const functionArn = process.env.EVALUATE_ARTICULATION_FUNCTION_ARN;
  if (!functionArn) return json(500, { error: 'EVALUATE_ARTICULATION_FUNCTION_ARN is not configured' });

  let payload: unknown;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  try {
    const response = await lambda.send(new InvokeCommand({
      FunctionName: functionArn,
      Payload: Buffer.from(JSON.stringify(payload)),
    }));

    const rawPayload = response.Payload ? Buffer.from(response.Payload).toString('utf8') : '{}';
    if (response.FunctionError) {
      return json(502, { error: 'articulation-evaluator failed', detail: JSON.parse(rawPayload || '{}') });
    }
    return json(200, JSON.parse(rawPayload));
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : 'Failed to invoke articulation-evaluator' });
  }
};
