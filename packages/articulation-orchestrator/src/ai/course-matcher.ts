import { ConverseCommand, type BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import type { CourseIdentifier } from '../domain/catalog-resolution.js';
import type { CatalogContent } from '../domain/work-record.js';

export interface MatchableCatalogCourse {
  candidateId: string;
  identifier: CourseIdentifier;
  catalogContent: CatalogContent;
}

export interface CourseMatcher {
  match(required: Omit<MatchableCatalogCourse, 'candidateId'>, candidates: MatchableCatalogCourse[]): Promise<CourseMatchDetermination[]>;
}

export interface CourseMatchDetermination {
  candidateId: string;
  isMatch: boolean;
}

const DeterminationsSchema = z.object({
  determinations: z.array(z.object({
    candidateId: z.string().min(1),
    isMatch: z.boolean(),
  }).strict()),
}).strict();

/**
 * Validates the complete, one-to-one decision set returned by the model.
 * Keeping this check outside the client makes every matching worker enforce it,
 * including clients substituted in tests or alternate deployments.
 */
export function validateMatchDeterminations(value: unknown, candidateIds: readonly string[]): CourseMatchDetermination[] {
  const parsed = DeterminationsSchema.safeParse(value);
  if (!parsed.success) throw new CourseMatcherError('The matching service returned an invalid decision set.');

  const expected = new Set(candidateIds);
  if (parsed.data.determinations.length !== expected.size) {
    throw new CourseMatcherError('The matching service returned an incomplete decision set.');
  }

  const seen = new Set<string>();
  for (const determination of parsed.data.determinations) {
    if (!expected.has(determination.candidateId) || seen.has(determination.candidateId)) {
      throw new CourseMatcherError('The matching service returned an invalid decision set.');
    }
    seen.add(determination.candidateId);
  }
  return parsed.data.determinations;
}

/** Bedrock Converse client using a required tool call for machine-readable decisions. */
export class BedrockCourseMatcher implements CourseMatcher {
  public constructor(
    private readonly client: Pick<BedrockRuntimeClient, 'send'>,
    private readonly modelId: string,
  ) {}

  public async match(required: Omit<MatchableCatalogCourse, 'candidateId'>, candidates: MatchableCatalogCourse[]): Promise<CourseMatchDetermination[]> {
    if (candidates.length === 0) return [];
    const response = await this.client.send(new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: 'Determine semantic course relevance. Return one explicit decision for every supplied candidate by calling the required tool. Do not omit, duplicate, or invent candidate IDs.' }],
      messages: [{
        role: 'user',
        content: [{ text: JSON.stringify({ requiredCourse: required, candidates }) }],
      }],
      toolConfig: {
        tools: [{ toolSpec: {
          name: 'submit_course_matches',
          description: 'Submit exactly one semantic match decision for each candidate course.',
          inputSchema: {
            json: {
              type: 'object', additionalProperties: false,
              required: ['determinations'],
              properties: {
                determinations: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    required: ['candidateId', 'isMatch'],
                    properties: { candidateId: { type: 'string' }, isMatch: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        } }],
        toolChoice: { tool: { name: 'submit_course_matches' } },
      },
    }));
    const toolUse = response.output?.message?.content?.find((block) => 'toolUse' in block)?.toolUse;
    if (!toolUse || toolUse.name !== 'submit_course_matches') {
      throw new CourseMatcherError('The matching service did not return a decision set.');
    }
    return validateMatchDeterminations(toolUse.input, candidates.map((candidate) => candidate.candidateId));
  }
}

export class CourseMatcherError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CourseMatcherError';
  }
}
