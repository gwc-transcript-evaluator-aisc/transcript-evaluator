import { ArticulationResultSchema, type ArticulationResult } from '../domain/articulation-result.js';
import type { RequiredCourse, DegreeProgram } from '../domain/degree-program.js';
import { normalizedRequiredCourseIdentifier } from '../domain/degree-program.js';
import type { OrchestrationRun } from '../domain/orchestration-run.js';
import type { PairResult, RequiredCourseResult } from '../domain/course-result.js';
import type { WorkRecord } from '../domain/work-record.js';
import { ResultsStore, resultLocatorFor } from '../store/results-store.js';
import type { RunsStore } from '../store/runs-store.js';
import type { WorkStore } from '../store/work-store.js';

export interface FinalizeResultDependencies {
  runs: Pick<RunsStore, 'get'>;
  workStore: Pick<WorkStore, 'list'>;
  results: Pick<ResultsStore, 'persistAndComplete'>;
  getDegreeProgram: (degreeProgramId: string) => DegreeProgram | undefined;
}

/** Assembles a deterministic aggregate and atomically makes it visible as completed. */
export class FinalizeResult {
  public constructor(private readonly dependencies: FinalizeResultDependencies) {}

  public async execute(runId: string): Promise<{ runId: string; resultLocator: ReturnType<typeof resultLocatorFor> }> {
    const run = await this.dependencies.runs.get(runId);
    if (!run) throw new FinalizeResultError('RUN_NOT_FOUND', 'Run was not found.');
    if (run.status === 'completed' && run.resultLocator) return { runId, resultLocator: run.resultLocator };
    if (run.status !== 'evaluating') throw new FinalizeResultError('RUN_NOT_READY', 'Run is not ready to finalize.');

    const program = this.dependencies.getDegreeProgram(run.degreeProgramId);
    if (!program) throw new FinalizeResultError('DEGREE_PROGRAM_NOT_FOUND', 'Degree program was not found.');
    const result = assembleArticulationResult(run, program, await this.dependencies.workStore.list(runId));
    const locator = resultLocatorFor(result);
    try {
      await this.dependencies.results.persistAndComplete(result);
    } catch (error) {
      const reconciled = await this.dependencies.runs.get(runId);
      if (reconciled?.status === 'completed'
        && reconciled.resultLocator?.resultKey === locator.resultKey
        && reconciled.resultLocator.resultSortKey === locator.resultSortKey) {
        return { runId, resultLocator: locator };
      }
      throw error;
    }
    return { runId, resultLocator: locator };
  }
}

export class FinalizeResultError extends Error {
  public constructor(
    public readonly code: 'RUN_NOT_FOUND' | 'RUN_NOT_READY' | 'DEGREE_PROGRAM_NOT_FOUND' | 'MISSING_STUDENT' | 'INCOMPLETE_REQUIRED_RESULTS' | 'INCOMPLETE_PAIR_RESULTS',
    message: string,
  ) {
    super(message);
    this.name = 'FinalizeResultError';
  }
}

export function assembleArticulationResult(run: OrchestrationRun, program: DegreeProgram, records: WorkRecord[]): ArticulationResult {
  const student = records.find((record): record is Extract<WorkRecord, { recordType: 'STUDENT' }> => record.recordType === 'STUDENT');
  if (!student) throw new FinalizeResultError('MISSING_STUDENT', 'Student snapshot was not found.');

  const requiredById = new Map(records
    .filter((record): record is Extract<WorkRecord, { recordType: 'REQUIRED' }> => record.recordType === 'REQUIRED')
    .map((record) => [record.requiredCourseId, record]));
  const expectedIds = program.requiredCourses.map(normalizedRequiredCourseIdentifier);
  if (requiredById.size !== expectedIds.length || expectedIds.some((id) => !requiredById.has(id))) {
    throw new FinalizeResultError('INCOMPLETE_REQUIRED_RESULTS', 'Required course work records are incomplete.');
  }

  const pairResults = new Map(records
    .filter((record): record is Extract<WorkRecord, { recordType: 'PAIR_RESULT' }> => record.recordType === 'PAIR_RESULT')
    .map((record) => [record.result.pairId, record.result]));
  const pairsByRequired = new Map<string, Extract<WorkRecord, { recordType: 'PAIR' }>[] >();
  for (const pair of records.filter((record): record is Extract<WorkRecord, { recordType: 'PAIR' }> => record.recordType === 'PAIR')) {
    const pairs = pairsByRequired.get(pair.requiredCourseId) ?? [];
    pairs.push(pair);
    pairsByRequired.set(pair.requiredCourseId, pairs);
  }

  const requiredCourseResults = expectedIds.map((requiredCourseId, index) => {
    const record = requiredById.get(requiredCourseId)!;
    return requiredResult(record, program.requiredCourses[index]!, pairsByRequired.get(requiredCourseId) ?? [], pairResults);
  });
  return ArticulationResultSchema.parse({
    resultId: run.runId,
    runId: run.runId,
    transcriptId: run.transcriptId,
    student: student.student,
    degreeProgramId: run.degreeProgramId,
    createdAt: run.createdAt,
    excludedTakenCourses: records
      .filter((record): record is Extract<WorkRecord, { recordType: 'EXCLUDED_TAKEN' }> => record.recordType === 'EXCLUDED_TAKEN')
      .sort((left, right) => left.sourceCourseId - right.sourceCourseId)
      .map(({ takenCourse, reasonCode, message }) => ({ takenCourse, reasonCode, message })),
    requiredCourseResults,
  });
}

function requiredResult(
  record: Extract<WorkRecord, { recordType: 'REQUIRED' }>,
  expectedCourse: RequiredCourse,
  pairs: Extract<WorkRecord, { recordType: 'PAIR' }>[],
  pairResults: Map<string, PairResult>,
): RequiredCourseResult {
  if (normalizedRequiredCourseIdentifier(record.requiredCourse) !== normalizedRequiredCourseIdentifier(expectedCourse)) {
    throw new FinalizeResultError('INCOMPLETE_REQUIRED_RESULTS', 'Required course work records do not match the program.');
  }
  const base = record.result ?? {
    requiredCourseId: record.requiredCourseId,
    requiredCourse: record.requiredCourse,
    requiredResolution: record.resolution,
    matchingOutcome: 'errored' as const,
    message: 'Course matching could not be completed.',
    pairResults: [],
  };
  if (base.matchingOutcome !== 'matched') return { ...base, pairResults: [] };
  const resolvedPairs = pairs.map((pair) => pairResults.get(pair.pairId));
  if (resolvedPairs.some((result) => !result)) {
    throw new FinalizeResultError('INCOMPLETE_PAIR_RESULTS', 'Course pair evaluation results are incomplete.');
  }
  return { ...base, pairResults: resolvedPairs.filter((result): result is PairResult => result !== undefined).sort((left, right) => left.pairId.localeCompare(right.pairId)) };
}
