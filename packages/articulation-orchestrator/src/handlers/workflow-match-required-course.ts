import { z } from 'zod';
import { bedrock, dynamo } from '../aws/clients.js';
import { BedrockCourseMatcher } from '../ai/course-matcher.js';
import { loadConfig } from '../config.js';
import { MatchRequiredCourse } from '../pipeline/match-required-course.js';
import { WorkStore } from '../store/work-store.js';

const InputSchema = z.object({ runId: z.string().uuid(), requiredCourseId: z.string().min(1) }).strict();

/** Matches a single prepared requirement and persists all selected pair references. */
export async function handler(event: unknown) {
  const input = InputSchema.parse(event);
  const config = loadConfig();
  return new MatchRequiredCourse({
    workStore: new WorkStore(dynamo, config.workTableName),
    courseMatcher: new BedrockCourseMatcher(bedrock, config.bedrockModelId),
  }).execute(input);
}
