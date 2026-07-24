import { assessArticulation } from './ai/articulation-assessor.js';
import { config, requireConfig } from './config.js';
import { EvaluateArticulationRequestSchema, type EvaluateArticulationResult, type NotFoundSide } from './domain/evaluation.js';
import { lookupCourse } from './store/catalog-lookup.js';
import { putEvaluation } from './store/evaluations-store.js';

/** Direct-invoke Lambda handler -- no API Gateway in front of this. An upstream
 * orchestrator (not built yet) is expected to have already resolved the exact
 * institution/academicYear/courseCode for both sides before invoking this function; this
 * handler does the DB lookups, then a single AI call, then persists the result. */
export async function handler(event: unknown): Promise<EvaluateArticulationResult> {
  requireConfig(['CATALOG_TABLE_NAME', config.catalogTable], ['EVALUATIONS_TABLE_NAME', config.evaluationsTable]);
  const request = EvaluateArticulationRequestSchema.parse(event);

  const [homeCourse, transferCourse] = await Promise.all([
    lookupCourse(request.home),
    lookupCourse(request.transfer),
  ]);

  if (!homeCourse || !transferCourse) {
    const missing: NotFoundSide = !homeCourse && !transferCourse ? 'both' : !homeCourse ? 'home' : 'transfer';
    return {
      kind: 'NOT_FOUND',
      missing,
      message: `No catalog record found for the ${missing === 'both' ? 'home and transfer' : missing} course. ` +
        'Resolve the correct institution/academicYear/courseCode against the catalog before requesting an evaluation.',
    };
  }

  const assessment = await assessArticulation({ homeCourse, transferCourse });
  const evaluation = await putEvaluation({
    home: request.home,
    transfer: request.transfer,
    homeCourse,
    transferCourse,
    assessment,
    modelId: config.bedrockModelId,
  });

  return { kind: 'EVALUATED', evaluation };
}
