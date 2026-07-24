import type {
  ArticulationResultDto,
  CatalogContentDto,
  CatalogResolutionDto,
  PairResultDto,
  RequiredCourseResultDto,
} from "@/lib/api/orchestratorTypes";
import type { Course, CourseComparison, EvaluationCriterion, RequiredCourse, SourceMaterial } from "@/types/course";
import type { EvaluationDecision } from "@/types/student";
import type { Student } from "@/types/student";

/** Everything the concept dashboard needs, derived from one real articulation result. */
export interface MappedResult {
  student: Student;
  requiredCourses: RequiredCourse[];
  comparisons: CourseComparison[];
  sourceMaterials: SourceMaterial[];
}

function catalogSourceContent(content: { description?: string; topics?: string[]; learningOutcomes?: string[] } | undefined): string | undefined {
  if (!content?.description) return undefined;
  const sections = [content.description];
  if (content.topics?.length) sections.push(`Topics:\n- ${content.topics.join("\n- ")}`);
  if (content.learningOutcomes?.length) sections.push(`Learning outcomes:\n- ${content.learningOutcomes.join("\n- ")}`);
  return sections.join("\n\n");
}

/** Real source material: catalog descriptions for each side plus a transcript-exclusion note. */
function mapSourceMaterials(result: ArticulationResultDto): SourceMaterial[] {
  const materials: SourceMaterial[] = [];
  const seen = new Set<string>();
  for (const requirement of result.requiredCourseResults) {
    const requiredContent = catalogSourceContent(requirement.requiredCatalogContent);
    const requiredId = `catalog-required-${requirement.requiredCourseId}`;
    if (requiredContent && !seen.has(requiredId)) {
      seen.add(requiredId);
      materials.push({ id: requiredId, type: "catalog", title: `${requirement.requiredCourse.courseCode} — ${requirement.requiredCourse.institution}`, content: requiredContent });
    }
    for (const pair of requirement.pairResults) {
      const takenContent = catalogSourceContent(pair.takenCatalogContent);
      const takenId = `catalog-taken-${pair.takenCourse.sourceCourseId}`;
      if (takenContent && !seen.has(takenId)) {
        seen.add(takenId);
        const label = pair.takenCourse.courseCode ?? `Course ${pair.takenCourse.sourceCourseId}`;
        const institution = pair.takenResolution.kind === "resolved" ? pair.takenResolution.resolved.institution : pair.takenCourse.rawInstitution ?? "Transfer institution";
        materials.push({ id: takenId, type: "catalog", title: `${label} — ${institution}`, content: takenContent });
      }
    }
  }
  if (result.excludedTakenCourses.length > 0) {
    materials.push({
      id: "transcript-excluded",
      type: "transcript",
      title: "Excluded transcript courses",
      content: result.excludedTakenCourses
        .map((excluded) => `${excluded.takenCourse.courseCode ?? `Course ${excluded.takenCourse.sourceCourseId}`}: ${excluded.message} (${excluded.reasonCode})`)
        .join("\n"),
    });
  }
  return materials;
}

function resolvedInstitution(resolution: CatalogResolutionDto, fallback: string): string {
  return resolution.kind === "resolved" ? resolution.resolved.institution : fallback;
}

function resolvedYear(resolution: CatalogResolutionDto, fallback: string): string {
  return resolution.kind === "resolved" ? resolution.resolved.academicYear : fallback;
}

/** Prefer an evaluated pair, best decision first, so the workspace shows the strongest match. */
function pickBestPair(pairs: PairResultDto[]): PairResultDto | undefined {
  if (pairs.length === 0) return undefined;
  const rank: Record<string, number> = { EQUIVALENT: 0, PARTIAL: 1, NOT_EQUIVALENT: 2 };
  const evaluated = pairs.filter((pair) => pair.outcome === "evaluated");
  const pool = evaluated.length > 0 ? evaluated : pairs;
  return [...pool].sort((left, right) => {
    const leftRank = left.decision ? rank[left.decision] : 3;
    const rightRank = right.decision ? rank[right.decision] : 3;
    return leftRank - rightRank;
  })[0];
}

function decisionStatus(decision?: PairResultDto["decision"]): EvaluationCriterion["status"] {
  if (decision === "EQUIVALENT") return "approved";
  if (decision === "PARTIAL") return "warning";
  if (decision === "NOT_EQUIVALENT") return "error";
  return "warning";
}

function overallDecisionFor(requirement: RequiredCourseResultDto, best: PairResultDto | undefined): EvaluationDecision {
  if (requirement.matchingOutcome !== "matched" || !best) return "pending";
  if (best.decision === "EQUIVALENT") return "approved";
  if (best.decision === "NOT_EQUIVALENT") return "denied";
  return "pending";
}

function requiredCourseStatus(requirement: RequiredCourseResultDto, best: PairResultDto | undefined): RequiredCourse["status"] {
  if (requirement.matchingOutcome === "matched") return best?.decision === "EQUIVALENT" ? "fulfilled" : "pending";
  if (requirement.matchingOutcome === "unmatched") return "pending";
  return "error";
}

function equivalentCourse(requirement: RequiredCourseResultDto): Course {
  const content: CatalogContentDto = requirement.requiredCatalogContent ?? {};
  const year = resolvedYear(requirement.requiredResolution, requirement.requiredCourse.academicYear);
  return {
    id: `equivalent-${requirement.requiredCourseId}`,
    institutionName: resolvedInstitution(requirement.requiredResolution, requirement.requiredCourse.institution),
    title: content.title ?? requirement.requiredCourse.courseTitle ?? requirement.requiredCourse.courseCode,
    courseNumber: requirement.requiredCourse.courseCode,
    description: content.description ?? "No catalog description available for this course.",
    credits: content.credits ?? 0,
    grade: "",
    semesterYear: `Semester: (${year})`,
    academicTerm: { system: "Semester", term: "", academicYear: year },
  };
}

function transferCourse(best: PairResultDto | undefined, requirementId: string): Course {
  if (!best) {
    return {
      id: `transfer-${requirementId}-none`,
      institutionName: "No matching transcript course",
      title: "—",
      courseNumber: "—",
      description: "No transcript course was matched to this requirement.",
      credits: 0,
      grade: "",
      semesterYear: "",
      academicTerm: { system: "Semester", term: "", academicYear: "" },
    };
  }
  const content: CatalogContentDto = best.takenCatalogContent ?? {};
  const year = resolvedYear(best.takenResolution, best.takenCourse.rawAcademicYear ?? "");
  return {
    id: `transfer-${best.pairId}`,
    institutionName: resolvedInstitution(best.takenResolution, best.takenCourse.rawInstitution ?? "Transfer institution"),
    title: content.title ?? best.takenCourse.courseTitle ?? best.takenCourse.courseCode ?? "Transcript course",
    courseNumber: best.takenCourse.courseCode ?? `#${best.takenCourse.sourceCourseId}`,
    description: content.description ?? "No catalog description available for this course.",
    credits: best.takenCourse.credits ?? content.credits ?? 0,
    grade: "",
    semesterYear: year ? `Semester: (${year})` : "",
    academicTerm: { system: "Semester", term: "", academicYear: year },
  };
}

/** Build the concept criteria matrix from the real signals we actually have. */
function evaluationCriteria(transfer: Course, equivalent: Course, best: PairResultDto | undefined): EvaluationCriterion[] {
  const descriptionStatus = decisionStatus(best?.decision);
  const criteria: EvaluationCriterion[] = [
    {
      field: "Course Description",
      transferValue: transfer.description,
      equivalentValue: equivalent.description,
      status: descriptionStatus,
      errorExplanation: descriptionStatus === "approved" ? undefined : best?.rationale ?? best?.message,
      policyReference: best?.decision
        ? `AI equivalence decision: ${best.decision}${best.confidence ? ` (confidence ${best.confidence})` : ""}.`
        : undefined,
    },
  ];
  if (transfer.credits || equivalent.credits) {
    const creditsStatus: EvaluationCriterion["status"] = transfer.credits >= equivalent.credits ? "approved" : "warning";
    criteria.push({
      field: "Credits",
      transferValue: String(transfer.credits),
      equivalentValue: String(equivalent.credits),
      status: creditsStatus,
      policyReference: "Credit units should match or exceed the equivalent course.",
    });
  }
  return criteria;
}

function comparisonFor(requirement: RequiredCourseResultDto): CourseComparison {
  const best = pickBestPair(requirement.pairResults);
  const equivalent = equivalentCourse(requirement);
  const transfer = transferCourse(best, requirement.requiredCourseId);
  const criteria = evaluationCriteria(transfer, equivalent, best);
  return {
    id: requirement.requiredCourseId,
    transferCourse: transfer,
    equivalentCourse: equivalent,
    evaluationCriteria: criteria,
    fieldComparisons: [],
    overallDecision: overallDecisionFor(requirement, best),
    errorExplanation: requirement.message ?? best?.message,
  };
}

/** Map one real articulation result into the concept dashboard's data shapes. */
export function mapArticulationResult(result: ArticulationResultDto): MappedResult {
  const firstResolvedInstitution = result.requiredCourseResults
    .flatMap((requirement) => requirement.pairResults)
    .map((pair) => (pair.takenResolution.kind === "resolved" ? pair.takenResolution.resolved.institution : pair.takenCourse.rawInstitution))
    .find((value): value is string => Boolean(value));

  const student: Student = {
    id: result.student.studentKey,
    name: result.student.displayName,
    studentId: result.student.externalStudentId ?? result.student.studentKey,
    transferInstitution: firstResolvedInstitution ?? "—",
    intendedMajor: "",
    email: "",
    phone: "",
    enrollmentDate: "",
    applyingFor: result.degreeProgramId,
  };

  const requiredCourses: RequiredCourse[] = result.requiredCourseResults.map((requirement) => {
    const best = pickBestPair(requirement.pairResults);
    return {
      id: requirement.requiredCourseId,
      courseNumber: requirement.requiredCourse.courseCode,
      title: requirement.requiredCourse.courseTitle ?? requirement.requiredCourse.courseCode,
      status: requiredCourseStatus(requirement, best),
      matchedTransferCourse: best?.takenCourse.courseCode,
    };
  });

  const comparisons = result.requiredCourseResults.map(comparisonFor);
  const sourceMaterials = mapSourceMaterials(result);
  return { student, requiredCourses, comparisons, sourceMaterials };
}
