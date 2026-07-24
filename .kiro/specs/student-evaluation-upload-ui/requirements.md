# Requirements Document

## Introduction

The frontend application (`packages/frontend`) currently renders the student evaluation dashboard using static mock data (`src/mock/students.ts`, `src/mock/courses.ts`). This feature wires the existing frontend components to the real Transcript API (`packages/transcript_processor/transcript-processor`) so that student records, transcript details, and course data are read from the database instead of mock fixtures. It also introduces a separate, on-demand Upload View that lets a user upload a new transcript PDF, distinct from the main Dashboard View, which is not shown unless the user explicitly opens it.

This feature does not modify backend routes, database schema, or the course-pair equivalency evaluator package (`articulation-evaluator`). It is limited to frontend data-wiring and the addition of an on-demand upload surface.

## Glossary

- **Frontend_Application**: The Vite/React/TypeScript application in `packages/frontend`.
- **Transcript_API**: The existing HTTP API exposed by the Lambda handler in `packages/transcript_processor/transcript-processor/lambda_upload.py` (routes: `POST /upload`, `GET /status/{transcript_id}`, `GET /transcripts`, `GET /transcript/{transcript_id}`).
- **Dashboard_View**: The main screen rendered by `Dashboard.tsx`, showing the Student_Picker, transcript/evaluation details, and course comparison workspace. Rendered by default when the Frontend_Application loads.
- **Upload_View**: A screen or overlay, separate from the Dashboard_View, that contains the transcript upload control. Not rendered by default; only rendered after the user performs an explicit action (for example, clicking an "Upload Transcript" button) to open it.
- **Student_Picker**: The search control (based on `StudentSearch.tsx`) that lets a user find and select a transcript record from the list returned by `GET /transcripts`.
- **Transcript_Record**: A single entry returned by `GET /transcripts`, containing at minimum `transcript_id`, `filename`, `status`, `review_status`, `uploaded_at`, `pdf_url`, and `detail_url`.
- **Transcript_Detail**: The full payload returned by `GET /transcript/{transcript_id}`, containing the nested `student` object (with `courses` array) and optional `grading_legend`.
- **Selected_Transcript**: The Transcript_Record currently chosen by the user via the Student_Picker, whose Transcript_Detail is displayed in the Dashboard_View.

## Requirements

### Requirement 1: Student Picker data source

**User Story:** As an evaluator, I want to search for a student's transcript record using real data, so that I can find the correct record to review instead of seeing fixed sample names.

#### Acceptance Criteria

1. WHEN the Dashboard_View loads, THE Frontend_Application SHALL request the Transcript_Record list from the Transcript_API using `GET /transcripts`.
2. WHEN the Student_Picker receives a search query, THE Frontend_Application SHALL filter the retrieved Transcript_Record list client-side by matching the query against filename and student name fields, without issuing an additional Transcript_API request.
3. WHILE the Transcript_Record list request is in progress, THE Frontend_Application SHALL display a loading indicator in the Student_Picker.
4. IF the Transcript_Record list request fails, THEN THE Frontend_Application SHALL display an error message in the Student_Picker and SHALL NOT display stale or mock Transcript_Record data.
5. WHEN the Transcript_Record list contains more entries than a single page returned by `GET /transcripts`, THE Frontend_Application SHALL request additional pages using the `page` query parameter until all Transcript_Records are retrieved or a defined page limit is reached.
6. THE Frontend_Application SHALL NOT import or reference `src/mock/students.ts` or `src/mock/courses.ts` from the Student_Picker.

### Requirement 2: Selecting a transcript record

**User Story:** As an evaluator, I want to select a student from the Student_Picker and see their transcript details, so that I can review their evaluation.

#### Acceptance Criteria

1. WHEN a user selects a Transcript_Record from the Student_Picker, THE Frontend_Application SHALL request the Transcript_Detail using `GET /transcript/{transcript_id}` for that record.
2. WHEN the Transcript_Detail request succeeds, THE Frontend_Application SHALL update the Dashboard_View to display the returned student and course data as the Selected_Transcript.
3. WHILE the Transcript_Detail request is in progress, THE Frontend_Application SHALL display a loading indicator in the Dashboard_View.
4. IF the Transcript_Detail request fails, THEN THE Frontend_Application SHALL display an error message in the Dashboard_View and SHALL retain the previously displayed Selected_Transcript, if any.
5. IF the Transcript_Detail for the Selected_Transcript has no `student` object, THEN THE Frontend_Application SHALL display an empty-state message indicating that no student data has been extracted for the record.

### Requirement 3: Displaying student information from real data

**User Story:** As an evaluator, I want the student information card to reflect actual database fields, so that I am not shown placeholder contact or institution details.

#### Acceptance Criteria

1. WHEN a Transcript_Detail is loaded, THE Frontend_Application SHALL populate the student information display using the `student` fields returned by `GET /transcript/{transcript_id}` (`full_name`, `student_id`, `institution`, `major`, `program`, `email`, `phone`, `enrollment_date`, `graduation_date`, `gpa`, `total_credits`).
2. IF a given `student` field is null or absent in the Transcript_Detail, THEN THE Frontend_Application SHALL render a defined placeholder value for that field instead of an undefined or blank value.
3. THE Frontend_Application SHALL NOT reference the `Student` type fields `applyingFor` or `transferInstitution` from `src/types/student.ts` unless those fields are mapped from actual Transcript_API response data.

### Requirement 4: Displaying course data from real data

**User Story:** As an evaluator, I want the course comparison and requirements views to reflect the courses stored for the selected transcript, so that my review is based on actual extracted data.

#### Acceptance Criteria

1. WHEN a Transcript_Detail is loaded, THE Frontend_Application SHALL populate the course comparison workspace using the `courses` array nested under `student` in the Transcript_Detail response.
2. IF the `courses` array in the Transcript_Detail is empty, THEN THE Frontend_Application SHALL display an empty-state message in place of the course comparison workspace.
3. THE Frontend_Application SHALL NOT import or reference `src/mock/courses.ts` from the course comparison workspace, requirements card, or error summary card components.

### Requirement 5: On-demand Upload View

**User Story:** As an evaluator, I want to upload a new transcript PDF only when I choose to, so that the upload control does not clutter the main dashboard.

#### Acceptance Criteria

1. THE Frontend_Application SHALL render the Dashboard_View by default without rendering the Upload_View.
2. WHEN a user triggers the defined upload action (for example, clicking an "Upload Transcript" control), THE Frontend_Application SHALL render the Upload_View.
3. WHILE the Upload_View is open, THE Frontend_Application SHALL provide a control for the user to select a PDF file and submit it.
4. WHEN a user submits a PDF file from the Upload_View, THE Frontend_Application SHALL send the file to the Transcript_API using `POST /upload` with the multipart field name `pdf_file`.
5. IF a user selects a non-PDF file for upload, THEN THE Frontend_Application SHALL reject the file client-side and SHALL display an error message without sending a request to the Transcript_API.
6. WHEN a user closes the Upload_View without submitting a file, THE Frontend_Application SHALL return to the previously displayed Dashboard_View state.
7. WHEN `POST /upload` responds successfully, THE Frontend_Application SHALL display the returned `status` and `transcript_id` to the user within the Upload_View.
8. IF `POST /upload` fails or returns an error status, THEN THE Frontend_Application SHALL display an error message within the Upload_View and SHALL retain the Upload_View open for retry.

### Requirement 6: Upload processing status feedback

**User Story:** As an evaluator, I want to know when an uploaded transcript has finished processing, so that I know when it is ready to review.

#### Acceptance Criteria

1. WHEN a transcript upload is accepted by the Transcript_API, THE Frontend_Application SHALL poll `GET /status/{transcript_id}` for the resulting `transcript_id` until the returned `status` is a terminal value or a defined maximum polling duration is reached.
2. WHILE polling is in progress, THE Frontend_Application SHALL display the current processing status within the Upload_View.
3. WHEN the polled status becomes `completed`, THE Frontend_Application SHALL display a control allowing the user to open the newly processed Transcript_Detail in the Dashboard_View.
4. IF the polled status becomes `failed`, THEN THE Frontend_Application SHALL display the associated `error_message` within the Upload_View.

### Requirement 7: Removal of mock data dependency

**User Story:** As a developer, I want the mock data files removed from the runtime data path, so that the application cannot silently fall back to fixture data in production use.

#### Acceptance Criteria

1. THE Frontend_Application SHALL NOT import `currentStudent`, `mockStudents`, or `mockEvaluationStatus` from `src/mock/students.ts` in `App.tsx`, `Dashboard.tsx`, or `StudentSearch.tsx`.
2. WHERE mock data remains present in the repository for local development or Storybook-style manual testing, THE Frontend_Application SHALL isolate that usage to files outside the runtime import path of `App.tsx`.
