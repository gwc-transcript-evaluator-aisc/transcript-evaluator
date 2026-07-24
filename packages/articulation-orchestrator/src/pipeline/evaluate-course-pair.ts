import type { PairResult } from '../domain/course-result.js';
import type { WorkRecord } from '../domain/work-record.js';
import { workSortKey } from '../domain/work-record.js';
import type { EvaluatorClient } from '../evaluator/evaluator-client.js';
import type { WorkStore } from '../store/work-store.js';

export interface EvaluateCoursePairInput {
  runId: string;
  pairId: string;
}

export interface EvaluateCoursePairResult {
  runId: string;
  pairId: string;
  outcome: PairResult['outcome'];
  persisted: boolean;
}

export interface EvaluateCoursePairDependencies {
  workStore: Pick<WorkStore, 'get' | 'putIfAbsent'>;
  evaluatorClient: Pick<EvaluatorClient, 'evaluate'>;
  now?: () => Date;
}

type PairRecord = Extract<WorkRecord, { recordType: 'PAIR' }>;
type CandidateRecord = Extract<WorkRecord, { recordType: 'CANDIDATE' }>;
type RequiredRecord = Extract<WorkRecord, { recordType: 'REQUIRED' }>;

/** Evaluates one selected pair using only its own work records. */
export class EvaluateCoursePair {
  private readonly now: () => Date;

  public constructor(private readonly dependencies: EvaluateCoursePairDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  public async execute(input: EvaluateCoursePairInput): Promise<EvaluateCoursePairResult> {
    const pair = await this.dependencies.workStore.get(input.runId, workSortKey.pair(input.pairId));
    if (!pair || pair.recordType !== 'PAIR') {
      throw new EvaluateCoursePairError('PAIR_NOT_FOUND', 'Course pair work record was not found.');
    }

    const [required, candidate] = await Promise.all([
      this.dependencies.workStore.get(input.runId, workSortKey.required(pair.requiredCourseId)),
      this.dependencies.workStore.get(input.runId, workSortKey.candidate(pair.sourceCourseId)),
    ]);
    const result = await this.evaluate(pair, required, candidate);
    const timestamp = this.now().toISOString();
    const persisted = await this.dependencies.workStore.putIfAbsent({
      recordType: 'PAIR_RESULT', runId: input.runId, createdAt: timestamp, updatedAt: timestamp, result,
    });
    return { runId: input.runId, pairId: input.pairId, outcome: result.outcome, persisted };
  }

  private async evaluate(pair: PairRecord, required: WorkRecord | undefined, candidate: WorkRecord | undefined): Promise<PairResult> {
    if (candidate?.recordType !== 'CANDIDATE' || !hasPairPrerequisites(pair, required, candidate)) {
      return failedResult(pair, candidate, 'Course pair prerequisites are unavailable.');
    }

    try {
      const response = await this.dependencies.evaluatorClient.evaluate(pair.requiredIdentifier, pair.takenIdentifier);
      if (response.kind === 'NOT_FOUND') {
        return unresolvedResult(pair, candidate);
      }
      return {
        pairId: pair.pairId, takenCourse: candidate.takenCourse, takenResolution: candidate.resolution,
        outcome: 'evaluated', decision: response.evaluation.assessment.decision,
        confidence: response.evaluation.assessment.confidence, rationale: response.evaluation.assessment.rationale,
      };
    } catch {
      return failedResult(pair, candidate, 'Course evaluation could not be completed.');
    }
  }
}

export class EvaluateCoursePairError extends Error {
  public constructor(public readonly code: 'PAIR_NOT_FOUND', message: string) {
    super(message);
    this.name = 'EvaluateCoursePairError';
  }
}

function hasPairPrerequisites(pair: PairRecord, required: WorkRecord | undefined, candidate: WorkRecord | undefined): required is RequiredRecord & { recordType: 'REQUIRED' } {
  return required?.recordType === 'REQUIRED'
    && required.requiredCourseId === pair.requiredCourseId
    && candidate?.recordType === 'CANDIDATE'
    && candidate.sourceCourseId === pair.sourceCourseId
    && sameIdentifier(requiredIdentifier(required), pair.requiredIdentifier)
    && sameIdentifier(candidate.identifier, pair.takenIdentifier);
}

function requiredIdentifier(required: RequiredRecord) {
  return required.resolution.kind === 'resolved'
    ? { institution: required.resolution.resolved.institution, academicYear: required.resolution.resolved.academicYear, courseCode: required.requiredCourse.courseCode }
    : undefined;
}
function sameIdentifier(left: ReturnType<typeof requiredIdentifier> | CandidateRecord['identifier'], right: PairRecord['requiredIdentifier']): boolean {
  return left !== undefined && left.institution === right.institution && left.academicYear === right.academicYear && left.courseCode === right.courseCode;
}
function pairCandidate(pair: PairRecord, candidate: WorkRecord | undefined): CandidateRecord {
  if (candidate?.recordType === 'CANDIDATE') return candidate;
  // A valid pair always has a candidate. This branch is only used for corrupt work data,
  // where PairResult cannot be constructed without the required taken-course snapshot.
  throw new EvaluateCoursePairError('PAIR_NOT_FOUND', `Course pair ${pair.pairId} has no candidate work record.`);
}
function failedResult(pair: PairRecord, candidate: WorkRecord | undefined, message: string): PairResult {
  const source = pairCandidate(pair, candidate);
  return { pairId: pair.pairId, takenCourse: source.takenCourse, takenResolution: source.resolution, outcome: 'failed', message };
}
function unresolvedResult(pair: PairRecord, candidate: CandidateRecord): PairResult {
  return { pairId: pair.pairId, takenCourse: candidate.takenCourse, takenResolution: candidate.resolution, outcome: 'unresolved', message: 'A catalog course for this pair is unavailable.' };
}
