import type { CatalogContentLookup } from '../catalog/catalog-content-lookup.js';
import type { CatalogKeyResolver } from '../catalog/catalog-key-resolver.js';
import type { CatalogDirectory } from '../catalog/catalog-cache-store.js';
import type { CatalogResolution } from '../domain/catalog-resolution.js';
import { normalizedRequiredCourseIdentifier, type DegreeProgram } from '../domain/degree-program.js';
import type { RequiredCourseResult } from '../domain/course-result.js';
import type { TakenCourse, TranscriptDetailDto } from '../domain/transcript.js';
import type { WorkRecord } from '../domain/work-record.js';
import { WorkStore } from '../store/work-store.js';
import { normalizeTranscript } from '../transcript/normalize-transcript.js';

export interface PrepareRunInput {
  runId: string;
  transcriptId: number;
  degreeProgramId: string;
}

export interface PrepareRunResult {
  runId: string;
  requiredCourseIds: string[];
}

type WorkRecordInput = WithoutMetadata<WorkRecord>;
type WithoutMetadata<T> = T extends unknown ? Omit<T, 'runId' | 'createdAt' | 'updatedAt'> : never;

export interface PrepareRunDependencies {
  transcriptClient: Pick<{ getDetail(transcriptId: number): Promise<TranscriptDetailDto> }, 'getDetail'>;
  getDegreeProgram(degreeProgramId: string): DegreeProgram | undefined;
  getCatalogDirectory(): Promise<CatalogDirectory>;
  catalogKeyResolver: Pick<CatalogKeyResolver, 'resolve'>;
  catalogContentLookup: Pick<CatalogContentLookup, 'get'>;
  workStore: WorkStore;
  now?: () => Date;
}

/** Prepares every reusable run record from exactly one authoritative transcript snapshot. */
export class PrepareRun {
  private readonly now: () => Date;

  public constructor(private readonly dependencies: PrepareRunDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  public async execute(input: PrepareRunInput): Promise<PrepareRunResult> {
    const program = this.dependencies.getDegreeProgram(input.degreeProgramId);
    if (!program) throw new PrepareRunError('DEGREE_PROGRAM_NOT_FOUND', 'Degree program was not found.');

    // This is intentionally the sole Transcript Detail request in this operation.
    const detail = await this.dependencies.transcriptClient.getDetail(input.transcriptId);
    const normalized = normalizeTranscript(detail);
    const directory = await this.dependencies.getCatalogDirectory();

    await this.put(input.runId, { recordType: 'STUDENT', student: normalized.student });
    for (const excluded of normalized.excludedTakenCourses) {
      await this.put(input.runId, { recordType: 'EXCLUDED_TAKEN', ...excluded, sourceCourseId: excluded.takenCourse.sourceCourseId });
    }
    for (const course of normalized.takenCourses) await this.prepareTakenCourse(input.runId, course, directory);

    const requiredCourseIds: string[] = [];
    for (const course of program.requiredCourses) {
      const requiredCourseId = normalizedRequiredCourseIdentifier(course);
      requiredCourseIds.push(requiredCourseId);
      const resolved = await this.dependencies.catalogKeyResolver.resolve(course, directory);
      if (!resolved.identifier) {
        await this.put(input.runId, {
          recordType: 'REQUIRED', requiredCourseId, requiredCourse: course, resolution: resolved.resolution,
          result: unresolvedRequiredResult(requiredCourseId, course, resolved.resolution),
        });
        continue;
      }
      const content = await this.dependencies.catalogContentLookup.get(resolved.identifier);
      if (!content) {
        const resolution = contentUnavailable(resolved.resolution);
        await this.put(input.runId, {
          recordType: 'REQUIRED', requiredCourseId, requiredCourse: course, resolution,
          result: unresolvedRequiredResult(requiredCourseId, course, resolution),
        });
        continue;
      }
      const { courseCode: _courseCode, ...catalogContent } = content;
      await this.put(input.runId, {
        recordType: 'REQUIRED', requiredCourseId, requiredCourse: course,
        resolution: resolved.resolution, catalogContent,
      });
    }
    return { runId: input.runId, requiredCourseIds };
  }

  private async prepareTakenCourse(runId: string, takenCourse: TakenCourse, directory: CatalogDirectory): Promise<void> {
    const resolved = await this.dependencies.catalogKeyResolver.resolve({
      institution: takenCourse.rawInstitution,
      academicYear: takenCourse.rawAcademicYear,
      courseCode: takenCourse.courseCode,
    }, directory);
    if (!resolved.identifier) {
      await this.put(runId, excludedForResolution(takenCourse, resolved.resolution));
      return;
    }
    const content = await this.dependencies.catalogContentLookup.get(resolved.identifier);
    if (!content) {
      await this.put(runId, excludedForResolution(takenCourse, contentUnavailable(resolved.resolution)));
      return;
    }
    const { courseCode: _courseCode, ...catalogContent } = content;
    await this.put(runId, {
      recordType: 'CANDIDATE', sourceCourseId: takenCourse.sourceCourseId, takenCourse,
      resolution: resolved.resolution, identifier: resolved.identifier, catalogContent,
    });
  }

  private async put(runId: string, record: WorkRecordInput): Promise<void> {
    const timestamp = this.now().toISOString();
    await this.dependencies.workStore.put({ ...record, runId, createdAt: timestamp, updatedAt: timestamp } as WorkRecord);
  }
}

export class PrepareRunError extends Error {
  public constructor(public readonly code: 'DEGREE_PROGRAM_NOT_FOUND', message: string) {
    super(message);
    this.name = 'PrepareRunError';
  }
}

function excludedForResolution(takenCourse: TakenCourse, resolution: CatalogResolution): Omit<Extract<WorkRecord, { recordType: 'EXCLUDED_TAKEN' }>, 'runId' | 'createdAt' | 'updatedAt'> {
  return {
    recordType: 'EXCLUDED_TAKEN', sourceCourseId: takenCourse.sourceCourseId, takenCourse,
    reasonCode: resolution.kind === 'unresolved' ? resolution.reasonCode : 'CATALOG_COURSE_NOT_FOUND',
    message: resolution.kind === 'unresolved' ? resolution.message : 'Catalog course content is unavailable.',
  };
}

function contentUnavailable(resolution: CatalogResolution): CatalogResolution {
  if (resolution.kind === 'unresolved') return resolution;
  return {
    kind: 'unresolved', original: resolution.original,
    reasonCode: 'CATALOG_COURSE_NOT_FOUND', message: 'Catalog course content is unavailable.',
  };
}

function unresolvedRequiredResult(requiredCourseId: string, requiredCourse: DegreeProgram['requiredCourses'][number], requiredResolution: CatalogResolution): RequiredCourseResult {
  return {
    requiredCourseId, requiredCourse, requiredResolution, matchingOutcome: 'unresolved',
    message: requiredResolution.kind === 'unresolved' ? requiredResolution.message : 'Catalog course content is unavailable.',
    pairResults: [],
  };
}
