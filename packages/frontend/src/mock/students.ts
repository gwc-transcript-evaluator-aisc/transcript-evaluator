import { Student, EvaluationStatus } from "@/types/student";

export const mockStudents: Student[] = [
  {
    id: "1",
    name: "Maria Garcia",
    studentId: "GWC-2024-0847",
    transferInstitution: "ABC College",
    intendedMajor: "Computer Science",
    email: "m.garcia@email.com",
    phone: "(714) 555-0123",
    enrollmentDate: "Fall 2024",
    applyingFor: "Fall 2026",
  },
  {
    id: "2",
    name: "James Chen",
    studentId: "GWC-2024-1052",
    transferInstitution: "Santa Monica College",
    intendedMajor: "Business Administration",
    email: "j.chen@email.com",
    phone: "(310) 555-0456",
    enrollmentDate: "Spring 2025",
    applyingFor: "Spring 2026",
  },
  {
    id: "3",
    name: "Aisha Johnson",
    studentId: "GWC-2024-0633",
    transferInstitution: "Pasadena City College",
    intendedMajor: "Biology",
    email: "a.johnson@email.com",
    phone: "(626) 555-0789",
    enrollmentDate: "Fall 2024",
    applyingFor: "Fall 2025",
  },
];

export const mockEvaluationStatus: EvaluationStatus = {
  status: "in-progress",
  errorCount: 1,
  requirementsFulfilled: 3,
  totalRequirements: 3,
  currentCourseIndex: 1,
  totalCourses: 3,
};

export const currentStudent = mockStudents[0];
