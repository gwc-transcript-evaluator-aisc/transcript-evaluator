import { CourseComparison, SourceMaterial, RequiredCourse } from "@/types/course";

export const mockCourseComparisons: CourseComparison[] = [
  {
    id: "1",
    transferCourse: {
      id: "tc-1",
      institutionName: "ABC College",
      title: "Introduction to Computer Science",
      courseNumber: "CS 101",
      description:
        "Fundamental concepts of computer science including problem solving, algorithm development, data types, control structures, functions, arrays, and an introduction to object-oriented programming using Python.",
      credits: 3,
      grade: "A",
      semesterYear: "Semester: Fall (2023–2024)",
      academicTerm: { system: "Semester", term: "Fall", academicYear: "2023–2024" },
    },
    equivalentCourse: {
      id: "ec-1",
      institutionName: "Golden West Community College",
      title: "Introduction to Computer Science I",
      courseNumber: "CS G100",
      description:
        "Introduction to the discipline of computer science. Topics include problem solving, algorithm development, data representation, programming methodology using a high-level language, and an overview of hardware and software systems.",
      credits: 3,
      grade: "",
      semesterYear: "Semester: Fall (2023–2024)",
      academicTerm: { system: "Semester", term: "Fall", academicYear: "2023–2024" },
    },
    evaluationCriteria: [
      {
        field: "Course Description",
        transferValue:
          "Fundamental concepts of computer science including problem solving, algorithm development, data types, control structures, functions, arrays, and an introduction to object-oriented programming using Python.",
        equivalentValue:
          "Introduction to the discipline of computer science. Topics include problem solving, algorithm development, data representation, programming methodology using a high-level language, and an overview of hardware and software systems.",
        status: "approved",
        policyReference: "Policy 4.2 — Course descriptions must demonstrate ≥70% content overlap.",
      },
      {
        field: "Credits",
        transferValue: "3",
        equivalentValue: "3",
        status: "approved",
        policyReference: "Policy 3.1 — Credit units must match or exceed the equivalent course.",
      },
      {
        field: "Grade",
        transferValue: "A",
        equivalentValue: "C or better required",
        status: "approved",
        policyReference: "Policy 3.3 — Minimum grade of C (2.0) required for major courses.",
      },
      {
        field: "Semester/Trimester",
        transferValue: "Semester: Fall (2023–2024)",
        equivalentValue: "Within 5 years",
        status: "approved",
        policyReference: "Policy 5.1 — Courses must be completed within 5 years (STEM) or 7 years (Gen Ed).",
      },
    ],
    fieldComparisons: [
      { field: "Course Description", transferValue: "", equivalentValue: "", status: "approved" },
      { field: "Credits", transferValue: "3", equivalentValue: "3", status: "approved" },
      { field: "Grade", transferValue: "A", equivalentValue: "C or better", status: "approved" },
      { field: "Semester/Trimester", transferValue: "Fall 2023", equivalentValue: "Within 5 years", status: "approved" },
    ],
    overallDecision: "approved",
  },
  {
    id: "2",
    transferCourse: {
      id: "tc-2",
      institutionName: "ABC College",
      title: "Data Structures and Algorithms",
      courseNumber: "CS 201",
      description:
        "Study of fundamental data structures including linked lists, stacks, queues, trees, hash tables, and graphs. Analysis of algorithms for sorting, searching, and traversal. Implementation in Java.",
      credits: 4,
      grade: "B+",
      semesterYear: "Semester: Spring (2023–2024)",
      academicTerm: { system: "Semester", term: "Spring", academicYear: "2023–2024" },
    },
    equivalentCourse: {
      id: "ec-2",
      institutionName: "Golden West Community College",
      title: "Data Structures",
      courseNumber: "CS G200",
      description:
        "Abstract data types, stacks, queues, linked lists, trees, graphs, sorting and searching algorithms. Analysis of algorithms. Programming assignments in C++.",
      credits: 4,
      grade: "",
      semesterYear: "Semester: Spring (2023–2024)",
      academicTerm: { system: "Semester", term: "Spring", academicYear: "2023–2024" },
    },
    evaluationCriteria: [
      {
        field: "Course Description",
        transferValue:
          "Study of fundamental data structures including linked lists, stacks, queues, trees, hash tables, and graphs. Analysis of algorithms for sorting, searching, and traversal. Implementation in Java.",
        equivalentValue:
          "Abstract data types, stacks, queues, linked lists, trees, graphs, sorting and searching algorithms. Analysis of algorithms. Programming assignments in C++.",
        status: "approved",
        policyReference: "Policy 4.2 — Course descriptions must demonstrate ≥70% content overlap.",
      },
      {
        field: "Credits",
        transferValue: "4",
        equivalentValue: "4",
        status: "approved",
        policyReference: "Policy 3.1 — Credit units must match or exceed the equivalent course.",
      },
      {
        field: "Grade",
        transferValue: "B+",
        equivalentValue: "C or better required",
        status: "approved",
        policyReference: "Policy 3.3 — Minimum grade of C (2.0) required for major courses.",
      },
      {
        field: "Semester/Trimester",
        transferValue: "Semester: Spring (2023–2024)",
        equivalentValue: "Within 5 years",
        status: "error",
        errorExplanation:
          "Course was taken in a semester not yet completed at the time of evaluation. Transcript shows In-Progress status for Spring 2024. Final grade not yet confirmed.",
        policyReference: "Policy 5.1 — Courses must be completed within 5 years. In-progress courses require final grade confirmation.",
      },
    ],
    fieldComparisons: [
      { field: "Course Description", transferValue: "", equivalentValue: "", status: "approved" },
      { field: "Credits", transferValue: "4", equivalentValue: "4", status: "approved" },
      { field: "Grade", transferValue: "B+", equivalentValue: "C or better", status: "approved" },
      { field: "Semester/Trimester", transferValue: "Spring 2024", equivalentValue: "Within 5 years", status: "error" },
    ],
    overallDecision: "pending",
    errorExplanation:
      "Semester/Trimester validation failed: The course shows Spring 2024 but the transcript indicates the course was still in-progress at time of submission. Final grade confirmation is required.",
  },
  {
    id: "3",
    transferCourse: {
      id: "tc-3",
      institutionName: "ABC College",
      title: "Calculus I",
      courseNumber: "MATH 150",
      description:
        "Limits, continuity, differentiation of algebraic and transcendental functions, applications of the derivative, introduction to integration, and the Fundamental Theorem of Calculus.",
      credits: 4,
      grade: "A-",
      semesterYear: "Semester: Fall (2022–2023)",
      academicTerm: { system: "Semester", term: "Fall", academicYear: "2022–2023" },
    },
    equivalentCourse: {
      id: "ec-3",
      institutionName: "Golden West Community College",
      title: "Calculus I",
      courseNumber: "MATH G180",
      description:
        "Limits, continuity, derivatives of algebraic and transcendental functions, applications of derivatives, differentials, antiderivatives, definite integrals, and the Fundamental Theorem of Calculus.",
      credits: 4,
      grade: "",
      semesterYear: "Semester: Fall (2022–2023)",
      academicTerm: { system: "Semester", term: "Fall", academicYear: "2022–2023" },
    },
    evaluationCriteria: [
      {
        field: "Course Description",
        transferValue:
          "Limits, continuity, differentiation of algebraic and transcendental functions, applications of the derivative, introduction to integration, and the Fundamental Theorem of Calculus.",
        equivalentValue:
          "Limits, continuity, derivatives of algebraic and transcendental functions, applications of derivatives, differentials, antiderivatives, definite integrals, and the Fundamental Theorem of Calculus.",
        status: "approved",
        policyReference: "Policy 4.2 — Course descriptions must demonstrate ≥70% content overlap.",
      },
      {
        field: "Credits",
        transferValue: "4",
        equivalentValue: "4",
        status: "approved",
        policyReference: "Policy 3.1 — Credit units must match or exceed the equivalent course.",
      },
      {
        field: "Grade",
        transferValue: "A-",
        equivalentValue: "C or better required",
        status: "approved",
        policyReference: "Policy 3.3 — Minimum grade of C (2.0) required for major courses.",
      },
      {
        field: "Semester/Trimester",
        transferValue: "Semester: Fall (2022–2023)",
        equivalentValue: "Within 5 years",
        status: "approved",
        policyReference: "Policy 5.1 — Courses must be completed within 5 years (STEM).",
      },
    ],
    fieldComparisons: [
      { field: "Course Description", transferValue: "", equivalentValue: "", status: "approved" },
      { field: "Credits", transferValue: "4", equivalentValue: "4", status: "approved" },
      { field: "Grade", transferValue: "A-", equivalentValue: "C or better", status: "approved" },
      { field: "Semester/Trimester", transferValue: "Fall 2022", equivalentValue: "Within 5 years", status: "approved" },
    ],
    overallDecision: "approved",
  },
];

export const mockSourceMaterials: SourceMaterial[] = [
  {
    id: "sm-1",
    type: "catalog",
    title: "ABC College 2023-2024 Course Catalog",
    content:
      "CS 101 - Introduction to Computer Science (3 units)\nPrerequisite: MATH 050 or equivalent.\nTransferable to UC/CSU.\nC-ID: COMP 112\n\nCS 201 - Data Structures and Algorithms (4 units)\nPrerequisite: CS 101 with a grade of C or better.\nTransferable to UC/CSU.\nC-ID: COMP 132\n\nMATH 150 - Calculus I (4 units)\nPrerequisite: MATH 120 or equivalent.\nTransferable to UC/CSU.\nC-ID: MATH 210",
  },
  {
    id: "sm-2",
    type: "transcript",
    title: "Official Transcript - Maria Garcia",
    content:
      "ABC College - Official Academic Transcript\nStudent: Maria Garcia\nStudent ID: ABC-22-4591\n\nFall 2022:\n  MATH 150 - Calculus I - 4 units - Grade: A-\n\nFall 2023:\n  CS 101 - Intro to Computer Science - 3 units - Grade: A\n\nSpring 2024:\n  CS 201 - Data Structures - 4 units - Grade: IP (In Progress)\n\nCumulative GPA: 3.78\nTotal Units Earned: 45",
  },
  {
    id: "sm-3",
    type: "policy",
    title: "Transfer Credit Evaluation Policies",
    content:
      "GOLDEN WEST COLLEGE — TRANSFER CREDIT POLICIES\n\n═══════════════════════════════════════════════════\nPolicy 3.1 — Credit Requirements\n═══════════════════════════════════════════════════\nCredit units must match or exceed the equivalent course.\nPartial credit is not accepted for major requirements.\n\n═══════════════════════════════════════════════════\nPolicy 3.3 — Grade Requirements\n═══════════════════════════════════════════════════\nMinimum grade of C (2.0) required for major courses.\nD grades accepted for general electives only.\nPass/No Pass accepted if P = C or better.\n\n═══════════════════════════════════════════════════\nPolicy 4.2 — Course Description Matching\n═══════════════════════════════════════════════════\nCourse descriptions must demonstrate at least 70% content\noverlap with the equivalent course. Key topics, learning\noutcomes, and prerequisite knowledge are weighted factors.\n\n═══════════════════════════════════════════════════\nPolicy 5.1 — Recency / Date of Completion\n═══════════════════════════════════════════════════\nMaximum Age of Transferable Coursework:\n• STEM subjects (CS, Math, Science, Engineering):\n  Must be completed within 5 years of the application date.\n• General Education & Humanities:\n  Must be completed within 7 years of the application date.\n• Business & Social Sciences:\n  Must be completed within 7 years.\n\nExpiration Rules:\n• Courses older than the maximum age are NOT automatically\n  rejected — they are flagged for manual review.\n• Department chairs may approve older coursework if the\n  subject matter has not substantially changed.\n• Lab science courses older than 5 years always require\n  manual review due to evolving methodologies.\n\nIn-Progress Coursework:\n• Courses currently in progress at the time of evaluation\n  require final grade confirmation before articulation.\n• Conditional acceptance may be granted pending final\n  transcript submission.\n\n═══════════════════════════════════════════════════\nPolicy 6.1 — Override Guidelines\n═══════════════════════════════════════════════════\nEvaluators may override AI decisions when professional\njudgment determines the automated assessment is incorrect.\nAll overrides must include written justification.\nOverrides are reviewed by the department chair quarterly.\n\n═══════════════════════════════════════════════════\nPolicy 7.1 — C-ID Descriptor System\n═══════════════════════════════════════════════════\nCourses with matching C-ID descriptors are automatically\neligible for articulation. See ASSIST.org for latest mappings.",
  },
];

export const mockRequiredCourses: RequiredCourse[] = [
  {
    id: "rc-1",
    courseNumber: "CS G100",
    title: "Introduction to Computer Science I",
    status: "fulfilled",
    matchedTransferCourse: "CS 101",
  },
  {
    id: "rc-2",
    courseNumber: "CS G200",
    title: "Data Structures",
    status: "error",
    matchedTransferCourse: "CS 201",
  },
  {
    id: "rc-3",
    courseNumber: "MATH G180",
    title: "Calculus I",
    status: "fulfilled",
    matchedTransferCourse: "MATH 150",
  },
];
