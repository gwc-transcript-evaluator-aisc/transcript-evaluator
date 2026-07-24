# Requirements Document

## Introduction

The Articulation_Orchestrator is a backend package between the existing Transcript_Processor, Course_Catalog_API, and Articulation_Evaluator. Given a completed transcript and a selected Degree_Program, it retrieves and normalizes transcript data, resolves catalog identifiers, selects semantically relevant course pairs, invokes the evaluator for each selected pair, and persists an aggregate for the frontend.

The feature also adds a repo-committed Degree_Program_Registry, a dedicated Upload_Page combining transcript upload with program selection, and a Dashboard_View backed by articulation results. It builds on `.kiro/specs/student-evaluation-upload-ui` without duplicating its raw-upload behavior.

## Glossary

- **Transcript_API**: Existing HTTP API exposed by `packages/transcript-processor`, including transcript status and detail routes.
- **Student_Key**: Stable orchestrator identifier `transcript-processor:<student.id>`, derived from the Transcript_API's non-null internal student id. It differs from nullable institution-issued `student_id`.
- **Taken_Course**: Normalized transcript course. Institution comes from `student.institution`, year from `term_year` then `year`, and code from `course_code`.
- **Degree_Program**: Statically declared program with a finite list of Required_Courses.
- **Required_Course**: Program requirement with institution, academic year, course code, and optional title.
- **CourseIdentifier**: Non-null `{ institution, academicYear, courseCode }` required by the evaluator.
- **Catalog_Resolution**: Side-specific provenance containing original and resolved institution/year, resolution method, and optional unresolved reason.
- **Candidate_Taken_Course**: Taken_Course that resolves to complete Catalog content.
- **Course_Pair**: One Required_Course and one Candidate_Taken_Course selected as semantically similar.
- **Required_Course_Result**: Result for one program requirement, containing a matching outcome and zero or more Pair_Results.
- **Pair_Result**: Evaluator outcome for one selected Course_Pair.
- **Orchestration_Work_Table**: Run-scoped intermediate storage. Step Functions passes identifiers rather than potentially large course/result values.
- **Orchestration_Run_Status**: `pending`, `matching`, `evaluating`, `completed`, or `failed`.
- **Request_Id**: Client-generated UUID reused across retries of one submission; it is also the run identifier and idempotency key.
- **Articulation_Result**: Immutable aggregate for one completed run.
- **Student_Directory**: Summary records in the Articulation_Results table supporting paginated, table-wide student discovery without scanning result records.
- **Upload_Page**: Full screen distinct from the existing on-demand Upload_View.
- **Dashboard_View**: Existing dashboard after replacement of mock-backed result rendering.

## Requirements

### Requirement 1: Static Degree Program registry

**User Story:** As an academic administrator, I want degree programs declared in repository code so orchestration uses reviewed, deployable requirements.

#### Acceptance Criteria

1. THE Degree_Program_Registry SHALL declare a fixed set of Degree_Programs in repository code/config, each with an identifier, a name of 1 to 200 characters, and zero to 500 Required_Courses.
2. THE Articulation_Orchestrator SHALL load the registry without querying a database for Degree_Program definitions.
3. THE Articulation_Orchestrator SHALL support listing all programs and retrieving one by identifier with its complete Required_Course list.
4. EACH Required_Course SHALL contain an institution of 1 to 200 characters, an academic year in `YYYY` or `YYYY-YYYY` format, a course code of 1 to 20 characters, and an optional title up to 200 characters.
5. IF a registry field is invalid, a program identifier is duplicated, or normalized Required_Course identifiers are duplicated within one program, THEN registry loading SHALL fail at build or module-load time.
6. IF a requested program is absent, THEN the API SHALL return a defined not-found response.

### Requirement 2: Transcript integration and normalization

**User Story:** As an evaluator, I want the orchestrator to use the Transcript_API's actual contract so incomplete extracted data is handled deterministically.

#### Acceptance Criteria

1. THE Articulation_Orchestrator SHALL use Transcript_API status and detail routes rather than query the Transcript_Processor database directly.
2. BEFORE creating a run, THE orchestrator SHALL verify that the transcript exists, has status `completed`, and its detail contains a student with a non-null internal numeric `student.id`.
3. IF any condition in 2.2 is false, THEN the request SHALL be rejected without creating a run and with a machine-readable reason.
4. THE orchestrator SHALL derive `studentKey` as `transcript-processor:<student.id>`, preserve nullable `student.student_id` as `externalStudentId`, and snapshot `student.full_name` or `Student <student.id>` when absent.
5. FOR each course, THE orchestrator SHALL derive raw institution from `student.institution`, raw academic year from the first valid value among `course.term_year` then `course.year`, and course code from `course.course_code`.
6. IF a Taken_Course lacks institution, valid academic year, or course code, THEN it SHALL be recorded once as an excluded unresolved Taken_Course and SHALL not enter matching or evaluation.
7. THE orchestrator SHALL fetch and normalize transcript detail once per run and persist normalized candidates in run-scoped storage for reuse by every Required_Course.

### Requirement 3: Idempotent run creation and lifecycle

**User Story:** As an evaluator, I want retries to refer to one run and status transitions to remain reliable.

#### Acceptance Criteria

1. WHEN creation is requested with `requestId`, `transcriptId`, and `degreeProgramId`, THE orchestrator SHALL conditionally create a run whose `runId` equals `requestId`, with status `pending`, and return without waiting for processing.
2. IF the same `requestId` is retried with the same input, THEN the API SHALL return the existing run without starting another execution.
3. IF the same `requestId` is reused with different input, THEN the API SHALL return conflict.
4. IF the program is absent or transcript validation fails, THEN no run SHALL be created.
5. THE state-machine execution name SHALL derive from `runId` so one run cannot start two executions.
6. IF starting the state machine fails after run creation, THEN the run SHALL become `failed` with `failedStage: starting`.
7. THE workflow SHALL persist explicit `pending` → `matching` → `evaluating` → `completed` transitions even when a collection is empty.
8. RUN-level transitions SHALL be performed by dedicated states, not parallel Map iterations.
9. IF an unhandled error occurs, THEN the run SHALL become `failed` with a sanitized error and `failedStage` of `starting`, `matching`, `evaluating`, or `persisting`.
10. GETting a known run SHALL return status, timestamps, inputs, sanitized failure data, and the exact result locator when completed; an unknown run SHALL return not found.

### Requirement 4: Catalog resolution and candidate preparation

**User Story:** As an evaluator, I want catalog identifiers resolved consistently and once per run.

#### Acceptance Criteria

1. FOR each Required_Course and structurally usable Taken_Course, THE resolver SHALL first test the exact combined key for raw institution and year.
2. IF absent, THE resolver SHALL compare normalized raw institution against known institutions and use an exact normalized match without AI.
3. ONLY IF no exact institution exists SHALL AI select one known institution or `none`.
4. IF no institution resolves, THEN the course SHALL be unresolved.
5. AFTER institution resolution, IF the requested year is unavailable, THEN the resolver SHALL choose the catalog year with the latest chronological end year.
6. IF the resolved institution has no catalog years, THEN the course SHALL be unresolved.
7. EACH resolution SHALL preserve original and resolved values and method `exact`, `exact-institution-year-fallback`, `ai-institution`, or `ai-institution-year-fallback`; unresolved resolutions SHALL preserve a reason.
8. THE result SHALL preserve independent Catalog_Resolution values for Required_Course and Taken_Course sides.
9. THE known-catalog cache SHALL not depend on one unbounded DynamoDB item, SHALL refresh periodically, and SHALL support bootstrap/lazy refresh when no successful snapshot exists.
10. THE preparation stage SHALL resolve and fetch complete Catalog content for each usable Taken_Course once, store each exclusion once, and persist reusable candidates in the Work table.
11. IF a Required_Course cannot resolve to a Catalog course by its required code, THEN it SHALL receive matching outcome `unresolved` and SHALL not be matched or evaluated.

### Requirement 5: Semantic matching

**User Story:** As an evaluator, I want only semantically relevant taken courses compared with each requirement.

#### Acceptance Criteria

1. THE matching stage SHALL make an AI determination for every Required_Course with resolved Catalog content against prepared candidates.
2. AI input SHALL contain complete available Catalog content for the requirement and every candidate: department, title, description, credits, learning outcomes, topics, and competencies.
3. AI output SHALL identify every supplied candidate exactly once as match or no-match; malformed, missing, duplicate, or unknown determinations SHALL fail that requirement's matching attempt.
4. ONLY candidates marked as matches SHALL create Course_Pairs; the full cross-product SHALL not be implicitly evaluated.
5. IF no candidate matches, THEN the Required_Course_Result SHALL be `unmatched` with zero Pair_Results.
6. IF matching fails, THEN the Required_Course_Result SHALL be `errored`, contain a sanitized message, and SHALL not stop other requirements.
7. THE stage SHALL persist results and selected pair references in run-scoped storage while Step Functions carries only bounded identifiers.

### Requirement 6: Per-pair evaluation

**User Story:** As an evaluator, I want every selected pair evaluated independently.

#### Acceptance Criteria

1. FOR each selected pair, THE orchestrator SHALL invoke the evaluator with resolved, non-null CourseIdentifiers for both sides.
2. `EVALUATED` SHALL map to Pair_Result `evaluated` while preserving decision, confidence, and rationale.
3. `NOT_FOUND` SHALL map to Pair_Result `unresolved` with a sanitized reason.
4. Invocation or response-validation failure SHALL map to Pair_Result `failed` with a sanitized reason.
5. EVERY pair SHALL be attempted regardless of another pair's outcome.
6. Pair_Results SHALL be persisted incrementally in run-scoped storage and complete aggregates SHALL not travel in Step Functions state payloads.

### Requirement 7: Idempotent aggregate persistence and retrieval

**User Story:** As an evaluator, I want immutable, queryable results consistent with run status.

#### Acceptance Criteria

1. A result SHALL contain `resultId`, `runId`, `studentKey`, display-name snapshot, optional external student id, transcript id, program id, timestamp, excluded Taken_Courses, and one Required_Course_Result per requirement.
2. EACH Required_Course_Result SHALL have one matching outcome from `matched`, `unmatched`, `unresolved`, or `errored`; only `matched` may contain Pair_Results, each with one outcome from `evaluated`, `unresolved`, or `failed`.
3. FINALIZATION SHALL use deterministic identity derived from `runId`, be retry-safe, and atomically persist the result, update its Student_Directory summary, and mark the run completed using a DynamoDB transaction.
4. AFTER an ambiguous finalization response, THE orchestrator SHALL read existing run/result state and converge on the same completed result.
5. DISTINCT runs for one transcript/program SHALL remain append-only using a sort key containing `createdAt` and `resultId`.
6. THE API SHALL return the latest transcript/program result and retrieve the exact result associated with a completed run.
7. THE API SHALL list one student's results newest-first and paginated.
8. THE Student_Directory SHALL support paginated table-wide listing without scanning result records, with one summary per `studentKey` and latest-result metadata.
9. THE API SHALL expose `GET /students` and `GET /students/{studentKey}/results` access paths.

### Requirement 8: Upload Page

**User Story:** As an evaluator, I want to upload a transcript and choose a program on one dedicated screen.

#### Acceptance Criteria

1. THE Upload_Page SHALL be a navigable full screen distinct from Dashboard_View and existing Upload_View.
2. IT SHALL list programs and provide PDF and program controls.
3. SUBMISSION SHALL be blocked with field-specific errors unless both are selected.
4. IT SHALL upload through the existing Transcript_API client and display processing status.
5. WHEN status first reaches `completed`, IT SHALL generate one Request_Id, request one run, and reuse that Request_Id for retries.
6. IF upload fails, THEN no run SHALL be requested and a sanitized error SHALL be shown.
7. IT SHALL poll run status every five seconds until completed, failed, or ten minutes elapsed.
8. ON completion, IT SHALL link to Dashboard_View using the exact result locator; on failure or timeout it SHALL show the message and stop polling.

### Requirement 9: Dashboard result consumption

**User Story:** As an evaluator, I want to browse students and completed results without mock data.

#### Acceptance Criteria

1. ON load, Dashboard_View SHALL request the paginated Student_Directory API rather than mock data or transcript records alone.
2. WHEN a student is selected, IT SHALL list that student's results, default to the newest, and allow every result to be selected.
3. IT SHALL render each matching outcome and every Pair_Result's decision, confidence, rationale, or distinct non-evaluated indication.
4. IF the URL contains an accessible exact result locator, THEN that result SHALL be selected.
5. AN empty Student_Directory SHALL render an empty state.
6. IF an active fetch fails, THEN stale or partial student/result data SHALL be cleared and an error state rendered.
7. THE articulation-result path SHALL not import mock student or course data.

### Requirement 10: Access control and safe errors

**User Story:** As a system owner, I want transcript-derived results protected and internal failures sanitized.

#### Acceptance Criteria

1. NON-local deployments SHALL protect every Orchestrator API route with one generated shared API key stored in Secrets Manager; only the API Lambda may read that secret.
2. THE frontend SHALL send the explicitly configured prototype key in the `x-api-key` header. Local deployments SHALL retain an explicit authorization bypass.
3. THE API SHALL not expose stack traces, prompts, model responses, AWS identifiers, raw downstream payloads, or database details.
4. FAILURES SHALL have a server-side correlation id and MAY return it with a stable public error code.
5. Invalid or missing API keys SHALL receive a generic unauthorized response that reveals nothing about protected resources.
6. THE deployment SHALL not output the API-key secret, and documentation SHALL state that browser-provided shared keys are not production-safe.
