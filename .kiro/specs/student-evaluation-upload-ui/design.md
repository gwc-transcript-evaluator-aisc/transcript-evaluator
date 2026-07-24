# Design Document

## Overview

This feature replaces the mock-data path in `packages/frontend` with a typed HTTP client against the existing Transcript_API (`packages/transcript_processor/transcript-processor/lambda_upload.py`), and adds a separate, on-demand Upload_View. No backend routes, database schema, or the `articulation-evaluator` package are changed.

The codebase currently has no data-fetching library (no React Query, no SWR — checked `packages/frontend/package.json`). All existing state is plain `useState`/`useEffect` in components (see `Dashboard.tsx`, `StudentSearch.tsx`). This design follows that same convention: a small set of custom hooks wrap `fetch` calls and expose `{ data, loading, error }`-shaped state, matching the project's existing style rather than introducing a new dependency.

## Architecture

```
App.tsx
 ├─ TopNavbar (adds "Upload Transcript" trigger button)
 ├─ Sidebar
 ├─ Dashboard.tsx
 │   ├─ StudentSearch.tsx  ──uses──> useTranscriptList()  ──uses──> transcriptApi.listAllTranscripts()
 │   ├─ StudentInformationCard.tsx   (renders mapped Student, unchanged props contract)
 │   ├─ RequirementsCard.tsx         (renders mapped RequiredCourse[])
 │   ├─ CourseComparisonWorkspace.tsx (renders mapped CourseComparison[])
 │   ├─ ErrorSummaryCard.tsx
 │   └─ SourceMaterialCard.tsx       (unchanged — no data source in requirements)
 └─ UploadTranscriptDialog.tsx (new, mounted by App.tsx, controlled by isUploadOpen)
     └─ uses useUploadTranscript() + useTranscriptStatusPolling()

src/lib/api/
 ├─ client.ts        typed fetch wrapper, base URL, error normalization
 ├─ types.ts          raw DTO shapes returned by Transcript_API
 └─ transcriptApi.ts  listTranscripts(), listAllTranscripts(), getTranscriptDetail(id),
                       getStatus(id), uploadTranscript(file)

src/lib/mappers.ts    DTO -> frontend type mapping (Student, Course, CourseComparison, RequiredCourse)

src/hooks/
 ├─ useTranscriptList.ts
 ├─ useTranscriptDetail.ts
 ├─ useUploadTranscript.ts
 └─ useTranscriptStatusPolling.ts
```

`src/mock/students.ts` and `src/mock/courses.ts` remain on disk (per Requirement 7.2, for local/manual testing) but are no longer imported by `App.tsx`, `Dashboard.tsx`, `StudentSearch.tsx`, `CourseComparisonWorkspace.tsx`, `RequirementsCard.tsx`, or `ErrorSummaryCard.tsx`.

## Components and Interfaces

### API Client Module (`src/lib/api/`)

**`types.ts`** — raw shapes exactly as returned by `lambda_upload.py` (`_summary`, `_handle_detail`, `_handle_status`, `_handle_upload`):

```typescript
export interface TranscriptSummaryDto {
  transcript_id: number;
  filename: string;
  s3_input_key: string | null;
  status: string; // ProcessingStatus enum value, e.g. "pending" | "submitted" | "completed" | "failed"
  review_status: string;
  uploaded_at: string | null;
  processed_at: string | null;
  error_message: string | null;
  pdf_url: string | null;
  detail_url: string;
  status_url: string;
}

export interface CourseDto {
  id: number;
  course_code: string | null;
  course_name: string | null;
  credits: number | null;
  grade: string | null;
  grade_points: number | null;
  term: string | null;
  term_season: string | null;
  term_year: number | null;
  year: number | null;
  instructor: string | null;
  department: string | null;
  status: string | null;
}

export interface StudentDto {
  id: number;
  full_name: string | null;
  student_id: string | null;
  date_of_birth: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  institution: string | null;
  institution_address: string | null;
  institution_website: string | null;
  institution_phone: string | null;
  program: string | null;
  major: string | null;
  minor: string | null;
  enrollment_date: string | null;
  graduation_date: string | null;
  gpa: number | null;
  total_credits: number | null;
  raw_text: string | null;
  courses: CourseDto[];
}

export interface GradingLegendEntryDto {
  symbol: string;
  meaning: string;
  grade_points: number | null;
}

export interface TranscriptDetailDto extends TranscriptSummaryDto {
  student?: StudentDto;
  grading_legend?: GradingLegendEntryDto[];
}

export interface TranscriptListResponseDto {
  page: number;
  per_page: number;
  total: number;
  transcripts: TranscriptSummaryDto[];
}

export interface UploadResponseDto {
  message: string;
  transcript_id: number;
  filename: string;
  status: string;
  status_url: string;
}

export interface StatusResponseDto {
  transcript_id: number;
  filename: string;
  status: string;
  uploaded_at: string | null;
  processed_at: string | null;
  error_message: string | null;
  detail_url?: string;
}
```

**`client.ts`** — thin fetch wrapper with normalized errors:

```typescript
const BASE_URL = import.meta.env.VITE_TRANSCRIPT_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const body = await safeJson(res);
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

export async function apiPostMultipart<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

async function safeJson(res: Response) {
  try { return await res.json(); } catch { return null; }
}
```

**`transcriptApi.ts`**:

```typescript
import { apiGet, apiPostMultipart } from "./client";
import {
  TranscriptListResponseDto, TranscriptDetailDto, UploadResponseDto, StatusResponseDto,
} from "./types";

const MAX_PAGES = 50; // defined page limit per Requirement 1.5

export function listTranscripts(page: number, perPage = 20) {
  return apiGet<TranscriptListResponseDto>(`/transcripts?page=${page}&per_page=${perPage}`);
}

/** Fetches every page of /transcripts, up to MAX_PAGES, and concatenates results. */
export async function listAllTranscripts(perPage = 50) {
  const first = await listTranscripts(1, perPage);
  const all = [...first.transcripts];
  const totalPages = Math.min(Math.ceil(first.total / first.per_page), MAX_PAGES);
  for (let page = 2; page <= totalPages; page++) {
    const next = await listTranscripts(page, perPage);
    all.push(...next.transcripts);
  }
  return all;
}

export function getTranscriptDetail(transcriptId: number) {
  return apiGet<TranscriptDetailDto>(`/transcript/${transcriptId}`);
}

export function getStatus(transcriptId: number) {
  return apiGet<StatusResponseDto>(`/status/${transcriptId}`);
}

export function uploadTranscript(file: File) {
  const form = new FormData();
  form.append("pdf_file", file);
  return apiPostMultipart<UploadResponseDto>("/upload", form);
}
```

### Type Mapping (`src/lib/mappers.ts`)

`src/types/student.ts` is extended (see "Data Models" below) to add `graduationDate`, `gpa`, and `totalCredits` fields so every DTO field named in Requirement 3.1 has a place to live; `transferInstitution` keeps holding `institution` (a reasonable, non-misleading mapping), but `applyingFor` is no longer repurposed to hold `graduation_date` — the Transcript_API has no "applying for" concept, so `applyingFor` is left as the placeholder value. `src/types/course.ts` is kept as-is. Placeholder constant:

```typescript
export const UNKNOWN_PLACEHOLDER = "Not available";

export function mapStudent(dto: StudentDto | undefined, transcriptId: number): Student {
  return {
    id: String(dto?.id ?? transcriptId),
    name: dto?.full_name ?? UNKNOWN_PLACEHOLDER,
    studentId: dto?.student_id ?? UNKNOWN_PLACEHOLDER,
    transferInstitution: dto?.institution ?? UNKNOWN_PLACEHOLDER,
    intendedMajor: dto?.major ?? dto?.program ?? UNKNOWN_PLACEHOLDER,
    email: dto?.email ?? UNKNOWN_PLACEHOLDER,
    phone: dto?.phone ?? UNKNOWN_PLACEHOLDER,
    enrollmentDate: dto?.enrollment_date ?? UNKNOWN_PLACEHOLDER,
    graduationDate: dto?.graduation_date ?? UNKNOWN_PLACEHOLDER,
    gpa: dto?.gpa ?? null,
    totalCredits: dto?.total_credits ?? null,
    applyingFor: UNKNOWN_PLACEHOLDER, // Transcript_API has no "applying for" concept; no longer repurposed from graduation_date
  };
}

export function mapCourse(dto: CourseDto, institutionName: string): Course {
  return {
    id: String(dto.id),
    institutionName,
    title: dto.course_name ?? UNKNOWN_PLACEHOLDER,
    courseNumber: dto.course_code ?? UNKNOWN_PLACEHOLDER,
    description: UNKNOWN_PLACEHOLDER, // not provided by Transcript_API
    credits: dto.credits ?? 0,
    grade: dto.grade ?? "",
    semesterYear: [dto.term_season, dto.term_year].filter(Boolean).join(" ") || (dto.term ?? UNKNOWN_PLACEHOLDER),
    academicTerm: {
      system: "Semester",
      term: dto.term_season ?? UNKNOWN_PLACEHOLDER,
      academicYear: dto.term_year ? String(dto.term_year) : UNKNOWN_PLACEHOLDER,
    },
  };
}

/**
 * The Transcript_API does not compute course equivalency (that is the
 * articulation-evaluator package's job, out of scope for this feature).
 * Each extracted course is rendered as a single-sided comparison: the
 * transfer course holds real data, the equivalent side and evaluation
 * criteria are left empty/placeholder so the existing
 * CourseComparisonWorkspace UI can still render real transcript data
 * without inventing evaluation results.
 */
export function mapCourseToComparison(dto: CourseDto, institutionName: string): CourseComparison {
  const transferCourse = mapCourse(dto, institutionName);
  return {
    id: transferCourse.id,
    transferCourse,
    equivalentCourse: { ...transferCourse, id: `${transferCourse.id}-eq`, institutionName: UNKNOWN_PLACEHOLDER, description: UNKNOWN_PLACEHOLDER, grade: "" },
    evaluationCriteria: [],
    fieldComparisons: [],
    overallDecision: "pending",
  };
}

export function mapCoursesToRequiredCourses(dtos: CourseDto[]): RequiredCourse[] {
  return dtos.map((c) => ({
    id: String(c.id),
    courseNumber: c.course_code ?? UNKNOWN_PLACEHOLDER,
    title: c.course_name ?? UNKNOWN_PLACEHOLDER,
    status: c.grade ? "fulfilled" : "pending",
    matchedTransferCourse: c.course_code ?? undefined,
  }));
}

export function summaryToRecord(dto: TranscriptSummaryDto): TranscriptRecord {
  return { ...dto }; // TranscriptRecord === TranscriptSummaryDto shape, re-exported from lib/api/types
}
```

`CourseComparisonWorkspace`, `RequirementsCard`, and `ErrorSummaryCard` keep their existing prop contracts — only `Dashboard.tsx` changes what it passes in, so those three files require no internal edits beyond removing any stray mock imports (none currently exist in them).

### Student Type (`src/types/student.ts`)

Extended with three new fields, following the existing convention of plain `string` display fields with `UNKNOWN_PLACEHOLDER` substitution for missing data, except `gpa`/`totalCredits` which are numeric and use `null` for "missing" (since GPA/credit totals are consumed as numbers, not just displayed strings):

```typescript
export interface Student {
  id: string;
  name: string;
  studentId: string;
  transferInstitution: string;
  intendedMajor: string;
  email: string;
  phone: string;
  enrollmentDate: string;
  graduationDate: string; // new — was previously (incorrectly) stored in applyingFor
  gpa: number | null;          // new — from StudentDto.gpa
  totalCredits: number | null; // new — from StudentDto.total_credits
  applyingFor: string; // e.g., "Fall 2026"; no longer populated from Transcript_API data (no equivalent field), remains UNKNOWN_PLACEHOLDER
}
```

### StudentInformationCard (`src/components/StudentInformationCard.tsx`)

Gains three new display rows (GPA, Total Credits, Graduation Date) rendered after "Intended Major", using the same `Separator`-delimited row pattern as the existing fields. `gpa`/`totalCredits` are numeric-or-null, so the component formats them at render time (e.g. `student.gpa != null ? student.gpa.toFixed(2) : UNKNOWN_PLACEHOLDER`, `student.totalCredits ?? UNKNOWN_PLACEHOLDER`) rather than receiving pre-formatted strings — keeping the numeric type in `Student` for any future consumers that need the raw number, while the mapper still guarantees a placeholder-safe display fallback.

### Hooks (`src/hooks/`)

**`useTranscriptList.ts`** — loads once on mount (Requirement 1.1) via `listAllTranscripts()` (Requirement 1.5), exposes loading/error (1.3, 1.4):

```typescript
export function useTranscriptList() {
  const [records, setRecords] = useState<TranscriptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAllTranscripts()
      .then((all) => { if (!cancelled) setRecords(all); })
      .catch((err) => { if (!cancelled) { setError(err.message); setRecords([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { records, loading, error };
}
```

**`StudentSearch.tsx`** changes to call `useTranscriptList()` instead of importing `mockStudents`, and filter the returned `records` client-side against `filename`/student-name fields (Requirement 1.2). Because the list endpoint's summary DTO has no student name, `StudentSearch` filters on `filename` plus, once a lightweight name index is available from already-fetched detail responses, cached student names; at minimum it always filters on `filename`, satisfying 1.2 without an extra request. `onStudentSelect` is renamed in effect to `onRecordSelect(record: TranscriptRecord)` returning the summary row (the id needed for the detail fetch), while `Dashboard.tsx` retains the display name of type `Student` derived after detail load.

**`useTranscriptDetail.ts`** — fetches detail for a given `transcriptId | null` (Requirement 2.1–2.4):

```typescript
export function useTranscriptDetail(transcriptId: number | null) {
  const [detail, setDetail] = useState<TranscriptDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (transcriptId == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTranscriptDetail(transcriptId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => { if (!cancelled) setError(err.message); }) // detail intentionally NOT cleared, satisfies 2.4
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [transcriptId]);

  return { detail, loading, error };
}
```

`Dashboard.tsx` derives `student`, `courseComparisons`, and `requiredCourses` from `detail` via the mappers above, falling back to an empty-state message when `detail?.student` is absent (Requirement 2.5) or `detail.student.courses.length === 0` (Requirement 4.2).

### Upload_View

**Location and trigger (Requirement 5.1, 5.2):** `App.tsx` owns `const [isUploadOpen, setUploadOpen] = useState(false)`. `TopNavbar` gets a new `onUploadClick` prop rendering an "Upload Transcript" `Button`; clicking it calls `setUploadOpen(true)`. `UploadTranscriptDialog` is rendered by `App.tsx` (sibling to `Dashboard`, not inside it) using the existing shadcn `Dialog` primitive (already used in `CourseComparisonWorkspace.tsx`), controlled by `open={isUploadOpen}` / `onOpenChange={setUploadOpen}`. It is not rendered/mounted-visible by default — `Dialog`'s content only renders when `open` is true, satisfying 5.1 without any separate route.

**`useUploadTranscript.ts`** — validation + submit (Requirement 5.4, 5.5, 5.7, 5.8):

```typescript
export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function useUploadTranscript() {
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [result, setResult] = useState<UploadResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (file: File) => {
    if (!isPdfFile(file)) {
      setStatus("error");
      setError("Only PDF files are accepted.");
      return;
    }
    setStatus("uploading");
    setError(null);
    try {
      const res = await uploadTranscript(file);
      setResult(res);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    }
  };

  const reset = () => { setStatus("idle"); setResult(null); setError(null); };

  return { status, result, error, submit, reset };
}
```

On close without submitting (Requirement 5.6), `UploadTranscriptDialog`'s `onOpenChange` calls `reset()` and `setUploadOpen(false)`; since Dashboard state lives entirely in `Dashboard.tsx` and is untouched by this flow, the dashboard is unaffected.

**`useTranscriptStatusPolling.ts`** — polling loop (Requirement 6.1, 6.2, 6.3, 6.4):

```typescript
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 120_000;
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export function useTranscriptStatusPolling(transcriptId: number | null) {
  const [statusResponse, setStatusResponse] = useState<StatusResponseDto | null>(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (transcriptId == null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    setPolling(true);

    const tick = async () => {
      try {
        const res = await getStatus(transcriptId);
        if (cancelled) return;
        setStatusResponse(res);
        const elapsed = Date.now() - startedAt;
        if (TERMINAL_STATUSES.has(res.status) || elapsed >= MAX_POLL_DURATION_MS) {
          setPolling(false);
          return;
        }
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) setPolling(false);
      }
    };
    tick();

    return () => { cancelled = true; clearTimeout(timer); };
  }, [transcriptId]);

  return { statusResponse, polling };
}
```

`UploadTranscriptDialog` starts this hook with the `transcript_id` from a successful upload response, displays `statusResponse?.status` while `polling` is true, shows a "View Transcript" button when `statusResponse?.status === "completed"` (which calls a callback bubbled up to select that transcript in `Dashboard.tsx`), and shows `statusResponse?.error_message` when `statusResponse?.status === "failed"`.

## Data Models

```
TranscriptRecord      == TranscriptSummaryDto            (src/lib/api/types.ts)
TranscriptDetail      == TranscriptDetailDto              (src/lib/api/types.ts)
Student (frontend)    <- mapStudent(StudentDto)           (src/types/student.ts, extended with graduationDate, gpa, totalCredits)
Course (frontend)     <- mapCourse(CourseDto)              (src/types/course.ts, unchanged shape)
CourseComparison      <- mapCourseToComparison(CourseDto)  (src/types/course.ts, unchanged shape)
RequiredCourse         <- mapCoursesToRequiredCourses(CourseDto[])
```

`src/types/course.ts` is unchanged — all course-related adaptation happens in the mapping layer. `src/types/student.ts` is extended (see "Student Type" above) with `graduationDate`, `gpa`, and `totalCredits` so `mapStudent()` can fully satisfy Requirement 3.1 without repurposing unrelated fields; `StudentInformationCard.tsx` is updated to render the three new fields.

## Error Handling

- All API calls funnel through `client.ts`, which normalizes both HTTP-error and network-error cases into `ApiError` with a `message` string, so every hook has one consistent error shape to render.
- `useTranscriptList`: on error, `records` is reset to `[]` (never left holding a previous/stale list — Requirement 1.4) and `error` is set for the Student_Picker to render.
- `useTranscriptDetail`: on error, the previous `detail` value is deliberately **not** cleared (Requirement 2.4); `Dashboard.tsx` renders the error message alongside whatever `Selected_Transcript` was already showing.
- `useUploadTranscript`: client-side PDF validation happens before any network call, so invalid files never reach `client.ts` (Requirement 5.5). API failures set `status = "error"` without closing the dialog (Requirement 5.8).
- `useTranscriptStatusPolling`: a thrown/network error while polling stops the loop (`polling = false`) rather than retrying forever; the last known `statusResponse` (if any) remains visible.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Client-side transcript search is sound and complete

For any list of Transcript_Records and any search query string, filtering that list client-side SHALL return exactly the subset of records whose `filename` or associated student name contains the query (case-insensitively), with no false positives or false omissions, and SHALL NOT trigger any Transcript_API request.

**Validates: Requirements 1.2**

### Property 2: Paginated listing retrieves all records up to the page limit

For any total record count N and any per-page size P returned by a mocked paginated `/transcripts` endpoint, `listAllTranscripts()` SHALL return the union of all pages with no duplicate or missing `transcript_id` values, and SHALL stop issuing page requests once either all N records have been retrieved or the defined maximum page limit is reached.

**Validates: Requirements 1.5**

### Property 3: Selecting a record fetches the matching detail

For any Transcript_Record with a given `transcript_id`, selecting that record in the Student_Picker SHALL result in exactly one `GET /transcript/{transcript_id}` request using that same id.

**Validates: Requirements 2.1**

### Property 4: Detail fetch failure preserves the prior selection

For any previously displayed Selected_Transcript state (including the "none selected" state) and any Transcript_Detail request that fails, the displayed Selected_Transcript after the failure SHALL be unchanged from before the failed request, and an error indicator SHALL be shown.

**Validates: Requirements 2.4**

### Property 5: Student field mapping is complete and placeholder-safe

For any `StudentDto` payload, mapping it to the frontend `Student` type SHALL produce, for each of `name`, `studentId`, `transferInstitution`, `intendedMajor`, `email`, `phone`, `enrollmentDate`, and `graduationDate`, either the corresponding DTO-derived value (when the source DTO field is present) or the defined placeholder value `UNKNOWN_PLACEHOLDER` (never `undefined`, `null`, or an empty string) when the source DTO field is null or absent; and SHALL produce, for each of `gpa` and `totalCredits`, either the DTO's numeric value (when present) or `null` (when the source DTO field is null or absent).

**Validates: Requirements 3.1, 3.2**

### Property 6: Course array mapping preserves course data and count

For any array of `CourseDto` objects (including the empty array), mapping it to frontend `CourseComparison[]`/`RequiredCourse[]` SHALL produce an output array of the same length, where each output element's course code, name, credits, and grade correspond to the same-index input element, and an empty input array SHALL result in an empty-state rendering rather than the comparison workspace.

**Validates: Requirements 4.1, 4.2**

### Property 7: Upload gating accepts only genuine PDFs

For any `File` object, `isPdfFile(file)` SHALL return true if and only if the file's name ends in `.pdf` (case-insensitive) or its MIME type is `application/pdf`; submitting a file through the Upload_View SHALL call `POST /upload` if and only if `isPdfFile(file)` is true, and a rejected file SHALL produce a client-side error without any network call.

**Validates: Requirements 5.4, 5.5**

### Property 8: Closing the Upload_View without submitting is a no-op on the Dashboard

For any Dashboard_View state, opening the Upload_View and then closing it without submitting a file SHALL leave the Dashboard_View state (selected transcript, search query, evaluator decisions) identical to its state before the Upload_View was opened.

**Validates: Requirements 5.6**

### Property 9: Successful upload response is faithfully displayed

For any successful `POST /upload` response containing a `status` and `transcript_id`, the Upload_View's displayed status and transcript id SHALL equal the values from that response.

**Validates: Requirements 5.7**

### Property 10: Upload failure keeps the Upload_View open with an error

For any failed or error-status `POST /upload` response, the Upload_View SHALL remain open, SHALL display a derived error message, and SHALL NOT clear previously entered file selection state needed for retry.

**Validates: Requirements 5.8**

### Property 11: Status polling stops exactly at a terminal status or the time limit

For any sequence of `GET /status/{id}` responses returned over successive polls, the polling loop SHALL continue only while the most recent status is non-terminal (not `completed`/`failed`) and the elapsed time is below the defined maximum, SHALL display the most recently polled status at each step, and SHALL stop polling on the first poll where the status is terminal or the time limit is reached.

**Validates: Requirements 6.1, 6.2**

### Property 12: Failed processing surfaces the exact error message

For any polled status response with `status === "failed"` and any `error_message` string (including empty), the Upload_View SHALL display that exact `error_message` value.

**Validates: Requirements 6.4**

## Testing Strategy

**Unit tests** (example-based, cover Requirements not amenable to properties above):
- `App.tsx` renders `Dashboard` without `UploadTranscriptDialog` content visible by default (5.1).
- Clicking the "Upload Transcript" trigger renders the Upload_View (5.2), and it contains a file input and submit control (5.3).
- `StudentSearch`/`Dashboard` show a loading indicator while `useTranscriptList`/`useTranscriptDetail` report `loading = true` (1.3, 2.3).
- `Dashboard` renders the "no student data" empty state when `detail.student` is absent (2.5), and shows a "completed" control plus triggers the detail-open callback when polling reaches `completed` (6.3).
- Static check (code review / lint rule, not a test): no file in `App.tsx`, `Dashboard.tsx`, `StudentSearch.tsx`, `CourseComparisonWorkspace.tsx`, `RequirementsCard.tsx`, or `ErrorSummaryCard.tsx` imports from `src/mock/*` (1.6, 4.3, 7.1, 7.2).

**Property-based tests** (100+ iterations each, mapped 1:1 to the properties above):
- Properties 1, 2, 5, 6, 7, 11, 12 test pure functions (`filterTranscripts`, `listAllTranscripts` against a mocked paginated fetch, `mapStudent`, `mapCourse`/`mapCourseToComparison`, `isPdfFile`, the polling reducer/loop against a mocked sequence of status responses) and require no real network access.
- Properties 3, 4, 8, 9, 10 test the hooks (`useTranscriptDetail`, `useUploadTranscript`) with a mocked `transcriptApi` module (mock `fetch` or mock the `client.ts` functions), asserting on the hook's returned state across randomized inputs (ids, response payloads, failure injection, randomized prior Dashboard state).
- Each property test tag format: **Feature: student-evaluation-upload-ui, Property {n}: {property title}**.
