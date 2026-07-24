export interface Student {
  id: string;
  name: string;
  studentId: string;
  transferInstitution: string;
  intendedMajor: string;
  email: string;
  phone: string;
  enrollmentDate: string;
  applyingFor: string; // e.g., "Fall 2026"
}

export interface EvaluationStatus {
  status: "in-progress" | "completed" | "pending" | "review";
  errorCount: number;
  requirementsFulfilled: number;
  totalRequirements: number;
  currentCourseIndex: number;
  totalCourses: number;
}

export type EvaluationDecision = "approved" | "denied" | "override" | "pending";
