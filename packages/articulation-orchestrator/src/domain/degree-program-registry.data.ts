import type { DegreeProgram } from './degree-program.js';

/**
 * Reviewed, deployable degree-program definitions. The registry is intentionally
 * repository-resident; no program definition is loaded from a database.
 */
export const degreeProgramRegistryData: readonly DegreeProgram[] = [
  {
    id: 'associate-of-science-computer-science',
    name: 'Associate of Science in Computer Science',
    requiredCourses: [
      {
        institution: 'Summer Camp Community College',
        academicYear: '2024-2025',
        courseCode: 'CS 101',
        courseTitle: 'Introduction to Programming',
      },
      {
        institution: 'Summer Camp Community College',
        academicYear: '2024-2025',
        courseCode: 'CS 201',
        courseTitle: 'Data Structures',
      },
    ],
  },
  {
    id: 'nursing',
    name: 'Nursing',
    requiredCourses: [
      {
        institution: 'Golden West College',
        academicYear: '2025-2026',
        courseCode: 'ENGL C1000',
        courseTitle: 'College Composition',
      },
      {
        institution: 'Golden West College',
        academicYear: '2025-2026',
        courseCode: 'PSYC G118',
        courseTitle: 'Life Span Development Psychology',
      },
      {
        institution: 'Golden West College',
        academicYear: '2025-2026',
        courseCode: 'COMM C1000',
        courseTitle: 'Public Speaking',
      },
      {
        institution: 'Golden West College',
        academicYear: '2025-2026',
        courseCode: 'BIOL G220',
        courseTitle: 'Human Anatomy (with lab)',
      },
      {
        institution: 'Golden West College',
        academicYear: '2025-2026',
        courseCode: 'BIOL G225',
        courseTitle: 'Human Physiology (with lab)',
      },
      {
        institution: 'Golden West College',
        academicYear: '2025-2026',
        courseCode: 'BIOL G210',
        courseTitle: 'General Microbiology (with lab)',
      },
    ],
  },
];
