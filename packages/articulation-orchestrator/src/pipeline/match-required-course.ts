import { createHash } from 'node:crypto';
import type { CourseMatcher, MatchableCatalogCourse } from '../ai/course-matcher.js';
import type { CourseIdentifier } from '../domain/catalog-resolution.js';
import type { RequiredCourseResult } from '../domain/course-result.js';
import type { WorkRecord } from '../domain/work-record.js';
import { workSortKey } from '../domain/work-record.js';
import { WorkStore } from '../store/work-store.js';

export interface MatchRequiredCourseInput {
  runId: string;
  requiredCourseId: string;
}

export interface MatchRequiredCourseResult {
  runId: string;
  requiredCourseId: string;
  pairIds: string[];
  matchingOutcome: RequiredCourseResult['matchingOutcome'];
}

export interface MatchRequiredCourseDependencies {
  workStore: Pick<WorkStore, 'get' | 'list' | 'put'>;
  courseMatcher: CourseMatcher;
  now?: () => Date;
}

type RequiredRecord = Extract<WorkRecord, { recordType: 'REQUIRED' }>;
type CandidateRecord = Extract<WorkRecord, { recordType: 'CANDIDATE' }>;
type WithoutMetadata<T> = T extends unknown ? Omit<T, 'runId' | 'createdAt' | 'updatedAt'> : never;
type WorkRecordInput = WithoutMetadata<WorkRecord>;

/**
 * Discovers semantic candidate pairs for one prepared requirement. Failures are
 * converted to that requirement's outcome so sibling Map iterations can proceed.
 */
export class MatchRequiredCourse {
  private readonly now: () => Date;

  public constructor(private readonly dependencies: MatchRequiredCourseDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  public async execute(input: MatchRequiredCourseInput): Promise<MatchRequiredCourseResult> {
    const record = await this.dependencies.workStore.get(input.runId, workSortKey.required(input.requiredCourseId));
    if (!record || record.recordType !== 'REQUIRED') {
      throw new MatchRequiredCourseError('REQUIRED_COURSE_NOT_FOUND', 'Required course work record was not found.');
    }

    if (!isMatchable(record)) {
      const result = record.result ?? unresolvedResult(record);
      await this.putRequired(input.runId, { ...record, result });
      return outcome(input, result.matchingOutcome);
    }

    try {
      const candidates = (await this.dependencies.workStore.list(input.runId, 'CANDIDATE#'))
        .filter((candidate): candidate is CandidateRecord => candidate.recordType === 'CANDIDATE')
        .sort((left, right) => left.sourceCourseId - right.sourceCourseId);
      const candidateInputs = candidates.map(toCandidateInput);
      const decisions = await this.dependencies.courseMatcher.match(toRequiredInput(record), candidateInputs);
      // The matcher client validates its response, but validate here as a boundary
      // invariant for any injected implementation.
      const decisionByCandidate = indexDecisions(decisions, candidateInputs.map((candidate) => candidate.candidateId));
      const selected = candidates.filter((candidate) => decisionByCandidate.get(candidateId(candidate)) === true);
      const result = matchedOrUnmatchedResult(record, selected.length > 0);
      await this.putRequired(input.runId, { ...record, result });

      const pairIds: string[] = [];
      for (const candidate of selected) {
        const pairId = deterministicPairId(record.requiredCourseId, candidate.sourceCourseId);
        pairIds.push(pairId);
        await this.put(input.runId, {
          recordType: 'PAIR', pairId, requiredCourseId: record.requiredCourseId,
          sourceCourseId: candidate.sourceCourseId,
          requiredIdentifier: requiredIdentifier(record), takenIdentifier: candidate.identifier,
        });
      }
      return { ...outcome(input, result.matchingOutcome), pairIds };
    } catch (error) {
      // Surface the underlying cause (e.g. Bedrock AccessDenied/Validation) instead of
      // silently collapsing it into an opaque "errored" outcome.
      console.error('Course matching failed', { runId: input.runId, requiredCourseId: input.requiredCourseId, error });
      const result: RequiredCourseResult = {
        requiredCourseId: record.requiredCourseId, requiredCourse: record.requiredCourse,
        requiredResolution: record.resolution, matchingOutcome: 'errored',
        message: 'Course matching could not be completed.', pairResults: [],
      };
      await this.putRequired(input.runId, { ...record, result });
      return outcome(input, result.matchingOutcome);
    }
  }

  private async putRequired(runId: string, record: RequiredRecord): Promise<void> {
    await this.put(runId, { ...record, recordType: 'REQUIRED' });
  }

  private async put(runId: string, record: WorkRecordInput): Promise<void> {
    const timestamp = this.now().toISOString();
    await this.dependencies.workStore.put({ ...record, runId, createdAt: timestamp, updatedAt: timestamp } as WorkRecord);
  }
}

export class MatchRequiredCourseError extends Error {
  public constructor(public readonly code: 'REQUIRED_COURSE_NOT_FOUND', message: string) {
    super(message);
    this.name = 'MatchRequiredCourseError';
  }
}

export function deterministicPairId(requiredCourseId: string, sourceCourseId: number): string {
  return `pair-${createHash('sha256').update(`${requiredCourseId}\u0000${sourceCourseId}`).digest('hex')}`;
}

function isMatchable(record: RequiredRecord): record is RequiredRecord & { catalogContent: NonNullable<RequiredRecord['catalogContent']>; resolution: Extract<RequiredRecord['resolution'], { kind: 'resolved' }> } {
  return record.resolution.kind === 'resolved' && record.catalogContent !== undefined;
}
function requiredIdentifier(record: RequiredRecord & { resolution: Extract<RequiredRecord['resolution'], { kind: 'resolved' }> }): CourseIdentifier {
  return { institution: record.resolution.resolved.institution, academicYear: record.resolution.resolved.academicYear, courseCode: record.requiredCourse.courseCode };
}
function toRequiredInput(record: RequiredRecord & { catalogContent: NonNullable<RequiredRecord['catalogContent']>; resolution: Extract<RequiredRecord['resolution'], { kind: 'resolved' }> }): Omit<MatchableCatalogCourse, 'candidateId'> {
  return { identifier: requiredIdentifier(record), catalogContent: record.catalogContent };
}
function candidateId(candidate: CandidateRecord): string { return `candidate-${candidate.sourceCourseId}`; }
function toCandidateInput(candidate: CandidateRecord): MatchableCatalogCourse {
  return { candidateId: candidateId(candidate), identifier: candidate.identifier, catalogContent: candidate.catalogContent };
}
function indexDecisions(decisions: Awaited<ReturnType<CourseMatcher['match']>>, candidateIds: string[]): Map<string, boolean> {
  const expected = new Set(candidateIds);
  if (decisions.length !== expected.size) throw new Error('Invalid matching determinations');
  const indexed = new Map<string, boolean>();
  for (const decision of decisions) {
    if (!expected.has(decision.candidateId) || indexed.has(decision.candidateId) || typeof decision.isMatch !== 'boolean') throw new Error('Invalid matching determinations');
    indexed.set(decision.candidateId, decision.isMatch);
  }
  return indexed;
}
function unresolvedResult(record: RequiredRecord): RequiredCourseResult {
  return {
    requiredCourseId: record.requiredCourseId, requiredCourse: record.requiredCourse,
    requiredResolution: record.resolution, matchingOutcome: 'unresolved',
    message: record.resolution.kind === 'unresolved' ? record.resolution.message : 'Catalog course content is unavailable.', pairResults: [],
  };
}
function matchedOrUnmatchedResult(record: RequiredRecord, matched: boolean): RequiredCourseResult {
  return {
    requiredCourseId: record.requiredCourseId, requiredCourse: record.requiredCourse,
    requiredResolution: record.resolution, matchingOutcome: matched ? 'matched' : 'unmatched', pairResults: [],
  };
}
function outcome(input: MatchRequiredCourseInput, matchingOutcome: RequiredCourseResult['matchingOutcome']): MatchRequiredCourseResult {
  return { runId: input.runId, requiredCourseId: input.requiredCourseId, matchingOutcome, pairIds: [] };
}
