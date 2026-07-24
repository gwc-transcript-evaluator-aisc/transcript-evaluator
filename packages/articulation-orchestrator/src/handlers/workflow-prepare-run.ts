import { z } from 'zod';
import { bedrock, dynamo } from '../aws/clients.js';
import { BedrockInstitutionResolver } from '../ai/institution-resolver.js';
import { CatalogCacheStore } from '../catalog/catalog-cache-store.js';
import { CatalogContentLookup } from '../catalog/catalog-content-lookup.js';
import { CatalogKeyResolver } from '../catalog/catalog-key-resolver.js';
import { loadConfig } from '../config.js';
import { getDegreeProgram } from '../degree-programs/registry-service.js';
import { PrepareRun } from '../pipeline/prepare-run.js';
import { WorkStore } from '../store/work-store.js';
import { TranscriptClient } from '../transcript/transcript-client.js';

const InputSchema = z.object({ runId: z.string().uuid(), transcriptId: z.number().int().positive(), degreeProgramId: z.string().min(1) }).strict();

/** Fetches and persists all reusable preparation data; only requirement IDs leave the worker. */
export async function handler(event: unknown) {
  const input = InputSchema.parse(event);
  const config = loadConfig();
  const cache = new CatalogCacheStore({ cacheClient: dynamo, catalogClient: dynamo, cacheTableName: config.catalogCacheTableName, catalogTableName: config.catalogTableName });
  const resolver = new CatalogKeyResolver(new BedrockInstitutionResolver(bedrock, config.bedrockModelId));
  return new PrepareRun({
    transcriptClient: new TranscriptClient({ baseUrl: config.transcriptApiBaseUrl, authToken: config.transcriptApiAuthToken }),
    getDegreeProgram: (id) => { const result = getDegreeProgram(id); return result.kind === 'found' ? result.program : undefined; },
    getCatalogDirectory: () => cache.getOrRefresh(), catalogKeyResolver: resolver,
    catalogContentLookup: new CatalogContentLookup(dynamo, config.catalogTableName), workStore: new WorkStore(dynamo, config.workTableName),
  }).execute(input);
}
