import { ConverseCommand, type ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { bedrock } from '../aws/clients.js';
import { config } from '../config.js';
import { ArticulationAssessmentSchema, type ArticulationAssessment } from '../domain/evaluation.js';
import type { CourseRecord } from '../domain/course-record.js';
// Raw markdown text, inlined at bundle time via the esbuild `.md` -> `text` loader
// configured for this Lambda in lib/articulation-evaluator-stack.ts (see
// context/markdown-modules.d.ts for the type declaration).
import calGetcStandards from './context/cal-getc-standards.md';

/** Tool schema forcing the model to return exactly the fields in
 * ArticulationAssessmentSchema, so the response can be parsed without relying on the
 * model to produce well-formed freeform JSON. Kept in sync with that schema by hand --
 * there are only two call sites for this shape (here and the Zod schema), so a
 * generated JSON Schema wasn't worth the extra dependency. */
const ASSESSMENT_TOOL_NAME = 'submit_articulation_assessment';
const assessmentTool: ConverseCommandInput['toolConfig'] = {
  tools: [
    {
      toolSpec: {
        name: ASSESSMENT_TOOL_NAME,
        description: 'Submit the structured articulation transfer-equivalency assessment for this course pair.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              decision: {
                type: 'string',
                enum: ['EQUIVALENT', 'PARTIAL', 'NOT_EQUIVALENT'],
                description: 'Whether the transfer course is a full, partial, or no equivalent of the home course.',
              },
              confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
              rationale: { type: 'string', description: 'Concise justification citing specific content/outcome overlaps or gaps.' },
              creditHoursComparable: { type: 'boolean', description: 'Whether credit/contact hours are close enough to not be a barrier on their own.' },
              contentCoverageNotes: { type: 'string', description: 'Specific topics/outcomes present on one side but missing on the other, if any.' },
            },
            required: ['decision', 'confidence', 'rationale', 'creditHoursComparable'],
          },
        },
      },
    },
  ],
  toolChoice: { tool: { name: ASSESSMENT_TOOL_NAME } },
};

function summarizeCourse(label: string, course: CourseRecord): string {
  const lines = [
    `${label} course: ${course.courseCode}${course.courseTitle ? ` - ${course.courseTitle}` : ''}`,
    course.department ? `Department: ${course.department}` : undefined,
    course.credits !== undefined ? `Credits: ${course.credits}` : undefined,
    course.contactHours !== undefined ? `Contact hours: ${course.contactHours}` : undefined,
    course.description ? `Description: ${course.description}` : undefined,
    course.learningOutcomes?.length ? `Learning outcomes: ${course.learningOutcomes.join('; ')}` : undefined,
    course.topics?.length ? `Topics: ${course.topics.join('; ')}` : undefined,
    course.competencies?.length ? `Competencies: ${course.competencies.join('; ')}` : undefined,
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are an academic articulation specialist evaluating whether a transfer institution's course
is equivalent to a home institution's course, for transfer credit purposes. Base your judgment strictly on the
course data provided (learning outcomes, topics, competencies, credit/contact hours, description) -- do not assume
content that isn't stated. If information is sparse, reflect that with LOW confidence rather than guessing.
This is one input among several a human reviewer will use to make the final articulation decision -- it is not a
final decision by itself.

Reference the following Cal-GETC (California General Education Transfer Curriculum) standards when either course
is a California community college general-education course, or when the transfer decision otherwise turns on
Cal-GETC area eligibility, unit/grade thresholds, or credit-by-exam rules. If neither course is GE-related, these
standards are not relevant to the assessment.

<cal-getc-standards>
${calGetcStandards}
</cal-getc-standards>`;

/** Calls Bedrock (Converse API, tool-forced output) to assess whether the transfer
 * course is equivalent to the home course, given the actual catalog records for both.
 * Throws if the model doesn't return the forced tool call or returns an invalid shape --
 * callers should let that surface as a failure rather than persisting a bad assessment. */
export async function assessArticulation(input: { homeCourse: CourseRecord; transferCourse: CourseRecord }): Promise<ArticulationAssessment> {
  const userMessage = [
    summarizeCourse('Home', input.homeCourse),
    '',
    summarizeCourse('Transfer', input.transferCourse),
    '',
    'Assess whether the transfer course is equivalent, partially equivalent, or not equivalent to the home course.',
  ].join('\n');

  const response = await bedrock.send(new ConverseCommand({
    modelId: config.bedrockModelId,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: userMessage }] }],
    toolConfig: assessmentTool,
    // `temperature` is deprecated/rejected for this model (Claude Sonnet 5) -- Bedrock
    // returns a ValidationException if it's set at all, so only maxTokens is passed.
    inferenceConfig: { maxTokens: 1024 },
  }));

  const toolUse = response.output?.message?.content?.find((block) => block.toolUse?.name === ASSESSMENT_TOOL_NAME)?.toolUse;
  if (!toolUse) {
    throw new Error(`Bedrock did not return the expected ${ASSESSMENT_TOOL_NAME} tool call (stopReason=${response.stopReason})`);
  }
  return ArticulationAssessmentSchema.parse(toolUse.input);
}
