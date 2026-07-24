import { EvaluationDecision } from "./student";

export interface AcademicTerm {
  system: "Semester" | "Trimester" | "Quarter";
  term: string; // e.g., "Fall", "Spring", "Winter", "Summer"
  academicYear: string; // e.g., "2023–2024"
}

export interface Course {
  id: string;
  institutionName: string;
  title: string;
  courseNumber: string;
  description: string;
  credits: number;
  grade: string;
  semesterYear: string; // Display string
  academicTerm: AcademicTerm;
}

export interface EvaluationCriterion {
  field: "Course Description" | "Credits" | "Grade" | "Semester/Trimester";
  transferValue: string;
  equivalentValue: string;
  status: "approved" | "error" | "warning";
  errorExplanation?: string;
  policyReference?: string;
}

export interface CourseFieldComparison {
  field: string;
  transferValue: string;
  equivalentValue: string;
  status: "approved" | "error";
  errorExplanation?: string;
}

export interface CourseComparison {
  id: string;
  transferCourse: Course;
  equivalentCourse: Course;
  evaluationCriteria: EvaluationCriterion[];
  fieldComparisons: CourseFieldComparison[];
  overallDecision: EvaluationDecision;
  errorExplanation?: string;
}

export interface SourceMaterial {
  id: string;
  type: "catalog" | "transcript" | "policy";
  title: string;
  content: string;
  url?: string;
}

export interface RequiredCourse {
  id: string;
  courseNumber: string;
  title: string;
  status: "fulfilled" | "pending" | "error";
  matchedTransferCourse?: string;
}
