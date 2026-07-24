# Implementation Plan

- [x] 1. Scaffold the articulation-orchestrator package and infrastructure
  - Create the TypeScript/CDK package, build scripts, configuration loader, AWS clients, and stack entry points.
  - Define Runs, Work, Results, and Catalog Cache DynamoDB tables with encryption, PITR, retention policy, and required indexes.
  - Configure the HTTP API, generated Secrets Manager API-key validation, Lambda defaults, log retention, and least-privilege grants.
  - _Requirements: 3.1, 4.9, 7.5, 7.7, 7.8, 10.1_

- [x] 2. Implement core schemas and static Degree Program registry
  - Implement Required_Course, Degree_Program, Transcript DTO, Catalog_Resolution, work-record, run, and result schemas.
  - Require course code and validate normalized duplicate program requirements.
  - Add the repo-committed registry data module and list/get service with load-time validation.
  - _Requirements: 1.1-1.6, 7.1, 7.2_

- [x] 3. Implement the Transcript_API boundary and normalization
  - Implement typed status/detail HTTP clients with response validation, authentication, timeout, and sanitized errors.
  - Derive Student_Key, display-name fallback, external student id, inherited institution, and term-year/year precedence.
  - Produce exactly one excluded record for every Taken_Course lacking required identifiers.
  - _Requirements: 2.1-2.7, 10.2-10.4_

- [x] 4. Implement run persistence and idempotent create/status APIs
  - Implement conditional run creation with `runId = requestId`, identical-retry return, and conflicting-input response.
  - Validate Degree_Program and completed transcript detail before writing a run.
  - Start Step Functions with deterministic execution name and mark start failures as `failed/starting`.
  - Implement legal conditional stage transitions and GET run status, including completed result locator.
  - _Requirements: 3.1-3.10_

- [x] 5. Implement Catalog cache and key resolution
  - Implement snapshot metadata and bounded per-institution cache records.
  - Implement scheduled refresh plus locked bootstrap/lazy refresh and safe active-snapshot switching.
  - Implement exact combined key, exact normalized institution, AI institution, and chronological year fallback in order.
  - Preserve side-specific resolution provenance and sanitize unresolved reasons.
  - _Requirements: 4.1-4.9_

- [x] 6. Implement run preparation and Work-table storage
  - Implement idempotent work-store operations and typed sort-key helpers.
  - Fetch the transcript snapshot once, normalize courses, resolve Required_Courses and Taken_Courses, and fetch Catalog records.
  - Persist student snapshot, exclusions, candidates, and requirement records once per run.
  - Ensure reruns/retries overwrite deterministic work keys rather than duplicate data.
  - _Requirements: 2.7, 4.10, 4.11_

- [x] 7. Implement semantic Required_Course matching
  - Implement forced structured Bedrock output with one determination per candidate.
  - Include complete Required_Course and candidate Catalog content; add deterministic chunking when model input budget is exceeded.
  - Reject missing, duplicate, malformed, or unknown candidate decisions.
  - Persist `matched`, `unmatched`, `unresolved`, or `errored` requirement records and deterministic pair references.
  - Isolate failures per Required_Course.
  - _Requirements: 5.1-5.7_

- [x] 8. Implement the evaluator client and per-pair worker
  - Invoke the existing evaluator Lambda with validated resolved CourseIdentifiers.
  - Validate Lambda invocation and payload envelopes and map EVALUATED, NOT_FOUND, and failures.
  - Persist one deterministic Pair_Result per pair and isolate pair failures.
  - _Requirements: 6.1-6.6_

- [x] 9. Implement the bounded Step Functions workflow
  - Add explicit SetMatchingStatus and SetEvaluatingStatus states outside Map workers.
  - Wire PrepareRun, identifier-only Matching Map, compact pair listing, identifier-only Evaluation Map, and FinalizeResult.
  - Discard worker outputs after work persistence and use pagination/Distributed Map or nested execution when pair-reference input could exceed payload limits.
  - Add retry/backoff for transient Bedrock/Lambda/DynamoDB failures and stage-aware top-level catches.
  - _Requirements: 3.5-3.9, 5.7, 6.6_

- [x] 10. Implement idempotent result finalization
  - Assemble the aggregate from Work records with one Required_Course_Result per program requirement.
  - Generate deterministic result identity and collision-resistant result sort key.
  - Transact the conditional result put, newest-only Student_Directory update, and run completion update.
  - Implement ambiguous-response reconciliation that converges on the existing deterministic result.
  - _Requirements: 7.1-7.5_

- [x] 11. Implement result and student-directory APIs
  - Implement paginated `GET /students` using the directory partition without scanning result records.
  - Implement paginated newest-first student results, latest transcript/program result, and exact completed-run result.
  - Use opaque continuation cursors and principal-scoped authorization.
  - _Requirements: 7.6-7.9, 10.1, 10.5_

- [x] 12. Implement shared safe HTTP error and authorization handling
  - Return stable `{ code, message, correlationId? }` envelopes.
  - Log full server-side context under correlation IDs while excluding secrets and unnecessary student data.
  - Return generic unauthorized responses for invalid keys and keep the generated secret out of outputs and logs.
  - _Requirements: 10.1-10.5_

- [x] 13. Add typed frontend orchestrator clients and hooks
  - Add DTOs and clients for programs, run creation/status/result, Student_Directory, and student results.
  - Add prototype `x-api-key` forwarding, error normalization, pagination, cancellation, and stale-state clearing.
  - Implement run polling at five-second intervals with terminal and ten-minute timeout handling.
  - _Requirements: 8.2, 8.4-8.8, 9.1-9.6, 10.2_

- [x] 14. Implement the dedicated Upload Page
  - Add a navigable full-screen route distinct from Dashboard and existing Upload_View.
  - Add PDF/program validation and reuse existing transcript upload/status behavior.
  - Generate Request_Id once per valid submission and retain it across retries/rerenders.
  - Navigate completed runs using the exact run result locator and render failure/timeout states.
  - _Requirements: 8.1-8.8_

- [x] 15. Replace Dashboard mock-backed result consumption
  - Load and paginate Student_Directory summaries.
  - Load selected-student results, default to newest, support independent selection, and honor exact run-result navigation.
  - Render Required_Course matching states and Pair_Result evaluation states distinctly.
  - Clear stale dependent state on errors and remove mock imports from the articulation-result path.
  - _Requirements: 9.1-9.7_

- [x] 16. Validate domain behavior and integration contracts
  - Add focused tests for registry validation, transcript normalization, resolution ordering, year fallback, AI-output validation, outcome mapping, status transitions, work idempotency, and finalization reconciliation.
  - Add contract fixtures for current Transcript_API and evaluator handlers.
  - Add CDK assertions for tables, indexes, bounded workflow data flow, API-key secret IAM, retries, and catches.
  - Add frontend tests for Request_Id reuse, polling, timeout, exact-result navigation, pagination, outcome rendering, empty/error states, and mock-import removal.
  - _Requirements: 1.1-10.5_

- [x] 17. Run end-to-end smoke validation
  - Exercise empty Required_Courses, no Taken_Courses, excluded malformed courses, no matches, mixed evaluator outcomes, duplicate create retries, state-machine start failure, and ambiguous finalization recovery.
  - Confirm every completed run has exactly one retrievable aggregate and Student_Directory summary, and no workflow execution carries full Catalog/result aggregates in state.
  - _Requirements: 2.6, 3.2, 3.6-3.9, 5.5-5.7, 6.2-6.6, 7.1-7.9_
