export type OrchestrationRunStatus = "pending" | "matching" | "evaluating" | "completed" | "failed";
export type FailedStage = "starting" | "matching" | "evaluating" | "persisting";

export interface PublicErrorDto {
  code: string;
  message: string;
  correlationId?: string;
}

export interface ResultLocatorDto {
  resultKey: string;
  resultSortKey: string;
}

export interface CreateOrchestrationRunRequest {
  requestId: string;
  transcriptId: number;
  degreeProgramId: string;
}

export interface OrchestrationRunDto {
  runId: string;
  requestId: string;
  transcriptId: number;
  degreeProgramId: string;
  status: OrchestrationRunStatus;
  createdAt: string;
  updatedAt: string;
  failedStage?: FailedStage;
  failureCode?: string;
  failureMessage?: string;
  resultLocator?: ResultLocatorDto;
}

export interface RequiredCourseDto {
  institution: string;
  academicYear: string;
  courseCode: string;
  courseTitle?: string;
}

export interface DegreeProgramDto {
  id: string;
  name: string;
  requiredCourses: RequiredCourseDto[];
}

export interface StudentDirectorySummaryDto {
  studentKey: string;
  displayName: string;
  externalStudentId?: string;
  latestResultAt: string;
  latestResultId: string;
  resultCount: number;
}

export interface PageDto<T> {
  items: T[];
  cursor?: string;
}

export interface NormalizedStudentDto {
  studentKey: string;
  processorStudentId: number;
  externalStudentId?: string;
  displayName: string;
}

export interface TakenCourseDto {
  sourceCourseId: number;
  courseCode?: string;
  courseTitle?: string;
  department?: string;
  credits?: number;
  rawInstitution?: string;
  rawAcademicYear?: string;
}

export type CatalogResolutionDto =
  | {
      kind: "resolved";
      original: { institution: string; academicYear: string };
      resolved: { institution: string; academicYear: string };
      method: "exact" | "exact-institution-year-fallback" | "ai-institution" | "ai-institution-year-fallback";
    }
  | {
      kind: "unresolved";
      original: { institution?: string; academicYear?: string };
      reasonCode: string;
      message: string;
    };

export interface CatalogContentDto {
  department?: string;
  title?: string;
  description?: string;
  credits?: number;
  learningOutcomes?: string[];
  topics?: string[];
  competencies?: string[];
}

export interface PairResultDto {
  pairId: string;
  takenCourse: TakenCourseDto;
  takenResolution: CatalogResolutionDto;
  outcome: "evaluated" | "unresolved" | "failed";
  decision?: "EQUIVALENT" | "PARTIAL" | "NOT_EQUIVALENT";
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  rationale?: string;
  message?: string;
  /** Catalog content of the matched transcript course (description/topics/credits). */
  takenCatalogContent?: CatalogContentDto;
}

export interface RequiredCourseResultDto {
  requiredCourseId: string;
  requiredCourse: RequiredCourseDto;
  requiredResolution: CatalogResolutionDto;
  matchingOutcome: "matched" | "unmatched" | "unresolved" | "errored";
  message?: string;
  /** Catalog content of the required (destination) course (description/topics/credits). */
  requiredCatalogContent?: CatalogContentDto;
  pairResults: PairResultDto[];
}

export interface ArticulationResultDto {
  resultId: string;
  runId: string;
  transcriptId: number;
  student: NormalizedStudentDto;
  degreeProgramId: string;
  createdAt: string;
  excludedTakenCourses: Array<{
    takenCourse: TakenCourseDto;
    reasonCode: string;
    message: string;
  }>;
  requiredCourseResults: RequiredCourseResultDto[];
}
