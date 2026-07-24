export const config = {
  catalogTable: process.env.CATALOG_TABLE_NAME ?? '',
  evaluationsTable: process.env.EVALUATIONS_TABLE_NAME ?? '',
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-5',
};

export function requireConfig(...values: Array<[string, string]>): void {
  const missing = values.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Missing configuration: ${missing.join(', ')}`);
}
