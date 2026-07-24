# Implementation Plan: Student Evaluation Upload UI

## Overview

Wire `packages/frontend` to the real Transcript_API instead of `src/mock/*`, and add a separate, on-demand Upload_View. Work proceeds bottom-up: API client → mappers/filter → hooks → component wiring (removing mock imports) → upload feature (hooks, dialog, TopNavbar trigger). Property-based tests (fast-check) cover the 12 correctness properties in design.md; example-based unit tests (Vitest + Testing Library) cover the remaining acceptance criteria noted in the Testing Strategy.

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

## Tasks

- [ ] 0. Extend the frontend `Student` type
  - [ ] 0.1 Extend `src/types/student.ts` with `graduationDate: string`, `gpa: number | null`, and `totalCredits: number | null` fields per design.md, leaving `applyingFor` in place (no longer populated from `graduation_date`)
    - _Requirements: 3.1_

- [ ] 1. Set up testing infrastructure for the frontend package
  - [ ] 1.1 Add Vitest, Testing Library, and fast-check to `packages/frontend`
    - Add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, and `fast-check` as devDependencies in `packages/frontend/package.json` (pin exact versions consistent with the monorepo's existing `vitest` usage in `packages/shared`/`packages/course-catalog-api`)
    - Add a `test`/`test:watch` script (`vitest run` / `vitest`) and a minimal `vitest.config.ts` (jsdom environment, `src/**/*.test.ts(x)`)
    - _Requirements: supports testing of all requirements below_

- [ ] 2. Implement the API client foundation
  - [ ] 2.1 Define raw DTO types in `src/lib/api/types.ts`
    - Add `TranscriptSummaryDto`, `CourseDto`, `StudentDto`, `GradingLegendEntryDto`, `TranscriptDetailDto`, `TranscriptListResponseDto`, `UploadResponseDto`, `StatusResponseDto` exactly per design.md
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.4, 5.7, 6.1_

  - [ ] 2.2 Implement the fetch wrapper in `src/lib/api/client.ts`
    - Implement `ApiError`, `apiGet`, `apiPostMultipart`, and `safeJson` per design.md, normalizing both HTTP-error and network-error cases into a single `ApiError` shape
    - _Requirements: 1.4, 2.4, 5.4, 5.8_

  - [ ]* 2.3 Write unit tests for `client.ts`
    - Test that a non-ok response produces an `ApiError` with the server-provided message (or a default), and that a successful response resolves the parsed JSON body
    - _Requirements: 1.4, 2.4, 5.8_

- [ ] 3. Implement the transcriptApi module
  - [ ] 3.1 Implement `src/lib/api/transcriptApi.ts`
    - Implement `listTranscripts(page, perPage)`, `listAllTranscripts(perPage)` (loops until all records fetched or `MAX_PAGES` reached), `getTranscriptDetail(transcriptId)`, `getStatus(transcriptId)`, `uploadTranscript(file)` per design.md
    - _Requirements: 1.1, 1.5, 2.1, 5.4, 6.1_

  - [ ]* 3.2 Write property test for `listAllTranscripts`
    - **Property 2: Paginated listing retrieves all records up to the page limit**
    - **Validates: Requirements 1.5**
    - Mock a paginated `/transcripts` endpoint for randomized total record counts and per-page sizes; assert the union of pages has no duplicate/missing `transcript_id` values and that fetching stops at full retrieval or `MAX_PAGES`

- [ ] 4. Implement client-side filtering and the DTO-to-frontend mapping layer
  - [ ] 4.1 Implement `src/lib/filterTranscripts.ts`
    - Export a pure `filterTranscripts(records, query, nameLookup?)` function that matches `filename` (and, when available, an associated student name) case-insensitively against the query, with no network calls
    - _Requirements: 1.2_

  - [ ]* 4.2 Write property test for `filterTranscripts`
    - **Property 1: Client-side transcript search is sound and complete**
    - **Validates: Requirements 1.2**
    - For randomized record lists and query strings, assert the result equals exactly the subset matching case-insensitively, with no false positives/omissions, and that no API mock is invoked

  - [ ] 4.3 Implement `src/lib/mappers.ts`
    - Implement `UNKNOWN_PLACEHOLDER`, `mapStudent`, `mapCourse`, `mapCourseToComparison`, `mapCoursesToRequiredCourses`, `summaryToRecord` exactly per design.md, including mapping `dto.gpa` -> `gpa`, `dto.total_credits` -> `totalCredits`, and `dto.graduation_date` -> `graduationDate` (leaving `applyingFor` as the placeholder, not repurposed from `graduation_date`)
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_

  - [ ]* 4.4 Write property test for `mapStudent`
    - **Property 5: Student field mapping is complete and placeholder-safe**
    - **Validates: Requirements 3.1, 3.2**
    - For randomized `StudentDto` payloads (including null/absent fields), assert every mapped `Student` string field (`name`, `studentId`, `transferInstitution`, `intendedMajor`, `email`, `phone`, `enrollmentDate`, `graduationDate`) is present-and-derived when the DTO field exists, and equals `UNKNOWN_PLACEHOLDER` (never `undefined`/`null`/`""`) when it is null or absent; and assert `gpa`/`totalCredits` equal the DTO's numeric value when present or `null` when absent

  - [ ]* 4.5 Write property test for course array mapping
    - **Property 6: Course array mapping preserves course data and count**
    - **Validates: Requirements 4.1, 4.2**
    - For randomized `CourseDto[]` (including the empty array), assert `mapCourseToComparison`/`mapCoursesToRequiredCourses` produce same-length output with matching course code/name/credits/grade per index, and that an empty input signals the empty-state case

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement data-fetching hooks for listing and detail
  - [ ] 6.1 Implement `src/hooks/useTranscriptList.ts`
    - Load once on mount via `listAllTranscripts()`, expose `{ records, loading, error }`, and reset `records` to `[]` on error
    - _Requirements: 1.1, 1.3, 1.4, 1.5_

  - [ ] 6.2 Implement `src/hooks/useTranscriptDetail.ts`
    - Fetch detail for a given `transcriptId | null`, expose `{ detail, loading, error }`, and deliberately do NOT clear `detail` on a failed request
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 6.3 Write property test for `useTranscriptDetail` selection behavior
    - **Property 3: Selecting a record fetches the matching detail**
    - **Validates: Requirements 2.1**
    - With a mocked `transcriptApi.getTranscriptDetail`, assert that for randomized `transcript_id` values, rendering the hook with that id results in exactly one call to `getTranscriptDetail` with the same id

  - [ ]* 6.4 Write property test for detail-fetch failure handling
    - **Property 4: Detail fetch failure preserves the prior selection**
    - **Validates: Requirements 2.4**
    - For randomized prior `detail` states (including `null`) and a failing mocked `getTranscriptDetail`, assert the hook's `detail` after the failure equals the prior `detail` and `error` is set

- [ ] 7. Wire Dashboard, StudentSearch, and App to real data and remove mock imports
  - [ ] 7.1 Update `src/components/StudentSearch.tsx`
    - Replace `mockStudents`/`mockEvaluationStatus` imports with `useTranscriptList()` and `filterTranscripts()`; show a loading indicator while `loading` is true and an error message (no stale/mock data) on `error`; change the selection callback to `onRecordSelect(record: TranscriptRecord)`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 7.1_

  - [ ] 7.2 Update `src/components/Dashboard.tsx`
    - Replace mock imports with `useTranscriptDetail(selectedTranscriptId)`; derive `student`, `courseComparisons`, `requiredCourses` via the `mappers.ts` functions; show a loading indicator while detail is loading; render an empty-state message when `detail?.student` is absent and when `student.courses` is empty; retain the previous detail display on error
    - _Requirements: 2.2, 2.3, 2.5, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 7.1_

  - [ ] 7.2a Update `src/components/StudentInformationCard.tsx`
    - Add rendering for the new `graduationDate`, `gpa`, and `totalCredits` fields on the `Student` prop (per design.md's "StudentInformationCard" section), formatting `gpa`/`totalCredits` from `number | null` to a display string (placeholder when `null`)
    - _Requirements: 3.1, 3.2_

  - [ ] 7.3 Update `src/App.tsx`
    - Remove `currentStudent`/`mockStudents`/`mockEvaluationStatus` imports; add `const [isUploadOpen, setUploadOpen] = useState(false)` (not yet wired to UI in this task)
    - _Requirements: 5.1, 7.1_

  - [ ]* 7.4 Write unit tests for loading and empty-state rendering
    - Assert `StudentSearch` shows a loading indicator while `useTranscriptList` reports `loading = true` (1.3)
    - Assert `Dashboard` shows a loading indicator while `useTranscriptDetail` reports `loading = true` (2.3)
    - Assert `Dashboard` renders the "no student data" empty state when `detail.student` is absent (2.5)
    - _Requirements: 1.3, 2.3, 2.5_

- [ ] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement upload and status-polling hooks
  - [ ] 9.1 Implement `src/hooks/useUploadTranscript.ts`
    - Implement `isPdfFile(file)` and `useUploadTranscript()` (`status`, `result`, `error`, `submit`, `reset`) per design.md; validate PDF client-side before any network call
    - _Requirements: 5.4, 5.5, 5.7, 5.8_

  - [ ]* 9.2 Write property test for `isPdfFile` and upload gating
    - **Property 7: Upload gating accepts only genuine PDFs**
    - **Validates: Requirements 5.4, 5.5**
    - For randomized `File`-like inputs (varying name extension and MIME type), assert `isPdfFile` returns true iff name ends in `.pdf` (case-insensitive) or type is `application/pdf`, and that `submit` calls the mocked `uploadTranscript` iff `isPdfFile` is true, with a client-side error and no network call otherwise

  - [ ]* 9.3 Write property test for successful upload display state
    - **Property 9: Successful upload response is faithfully displayed**
    - **Validates: Requirements 5.7**
    - For randomized successful `UploadResponseDto` payloads from a mocked `uploadTranscript`, assert the hook's `result.status`/`result.transcript_id` equal the response values

  - [ ]* 9.4 Write property test for upload failure display state
    - **Property 10: Upload failure keeps the Upload_View open with an error**
    - **Validates: Requirements 5.8**
    - For randomized failure injections from a mocked `uploadTranscript`, assert `status === "error"`, `error` is set to a derived message, and no state is cleared that would prevent retry

  - [ ] 9.5 Implement `src/hooks/useTranscriptStatusPolling.ts`
    - Implement the polling loop per design.md (`POLL_INTERVAL_MS`, `MAX_POLL_DURATION_MS`, `TERMINAL_STATUSES`), stopping on terminal status, elapsed-time limit, or thrown error
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 9.6 Write property test for the polling stop condition
    - **Property 11: Status polling stops exactly at a terminal status or the time limit**
    - **Validates: Requirements 6.1, 6.2**
    - For randomized sequences of mocked `getStatus` responses and randomized terminal-status positions/timings, assert polling continues only while non-terminal and under the time limit, exposes the most recently polled status at each step, and stops on the first terminal/time-limit poll

  - [ ]* 9.7 Write property test for failed-status error display
    - **Property 12: Failed processing surfaces the exact error message**
    - **Validates: Requirements 6.4**
    - For randomized `status === "failed"` responses with randomized (including empty) `error_message` strings, assert the hook exposes that exact string

- [ ] 10. Implement the Upload_View UI and wire the trigger
  - [ ] 10.1 Create `src/components/UploadTranscriptDialog.tsx`
    - Build the dialog (shadcn `Dialog` primitive) with `open`/`onOpenChange` props, a file input + submit control, status/progress display while `useUploadTranscript`'s `status === "uploading"`, error display on `status === "error"`, and — once upload succeeds — start `useTranscriptStatusPolling` and show the polled status, a "View Transcript" control on `completed` (bubbling a callback to select that transcript), and `error_message` on `failed`; call `reset()` on close-without-submit
    - _Requirements: 5.2, 5.3, 5.6, 5.7, 5.8, 6.2, 6.3, 6.4_

  - [ ] 10.2 Update `src/components/TopNavbar.tsx`
    - Add an `onUploadClick` prop rendering an "Upload Transcript" button that invokes it
    - _Requirements: 5.2_

  - [ ] 10.3 Wire the dialog and trigger into `src/App.tsx`
    - Render `TopNavbar` with `onUploadClick={() => setUploadOpen(true)}` and `UploadTranscriptDialog` as a sibling of `Dashboard`, controlled by `isUploadOpen`/`setUploadOpen`; connect the dialog's "view transcript" callback to select that transcript in `Dashboard`
    - _Requirements: 5.1, 5.2, 5.6, 6.3_

  - [ ]* 10.4 Write unit tests for the Upload_View integration
    - Assert `App` renders `Dashboard` with no visible `UploadTranscriptDialog` content by default (5.1)
    - Assert clicking the "Upload Transcript" trigger renders the Upload_View containing a file input and submit control (5.2, 5.3)
    - Assert reaching `completed` status shows the "View Transcript" control and that clicking it triggers the detail-open callback (6.3)
    - _Requirements: 5.1, 5.2, 5.3, 6.3_

  - [ ]* 10.5 Write property test for close-without-submit behavior
    - **Property 8: Closing the Upload_View without submitting is a no-op on the Dashboard**
    - **Validates: Requirements 5.6**
    - For randomized prior Dashboard state (selected transcript, search query), assert opening then closing the Upload_View without submitting leaves that Dashboard state unchanged

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; they are all test-writing tasks (unit or property-based) and are not implemented by the coding agent by default.
- `src/mock/students.ts` and `src/mock/courses.ts` are left on disk per Requirement 7.2 and are not touched by this plan — only their imports from the runtime path (`App.tsx`, `Dashboard.tsx`, `StudentSearch.tsx`) are removed.
- `CourseComparisonWorkspace.tsx`, `RequirementsCard.tsx`, and `ErrorSummaryCard.tsx` need no internal edits per design.md (no existing mock imports, unchanged prop contracts) and so have no dedicated tasks.
- Property tests use fast-check with mocked `fetch`/`transcriptApi` functions; no real network access is required for any test in this plan.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1", "1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "4.1", "4.3", "10.2"] },
    { "id": 2, "tasks": ["2.3", "3.1", "4.2", "4.4", "4.5"] },
    { "id": 3, "tasks": ["3.2", "6.1", "6.2", "9.1"] },
    { "id": 4, "tasks": ["6.3", "6.4", "7.1", "7.2", "7.2a", "7.3", "9.5"] },
    { "id": 5, "tasks": ["7.4", "9.2", "9.3", "9.4", "9.6", "9.7"] },
    { "id": 6, "tasks": ["10.1"] },
    { "id": 7, "tasks": ["10.3"] },
    { "id": 8, "tasks": ["10.4", "10.5"] }
  ]
}
```
