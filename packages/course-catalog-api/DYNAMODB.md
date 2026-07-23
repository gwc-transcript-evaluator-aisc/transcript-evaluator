# Catalog Table Schema

Single DynamoDB table (`Catalog` in `lib/course-catalog-api-stack.ts`), single-table design, on-demand billing, `TableEncryption.AWS_MANAGED`, no GSIs.

Source of truth: `src/domain/course.ts` (types + key builders), `src/jobs/catalog-store.ts` (access).

## Keys

- Partition key: `catalogId` (string)
- Sort key: `sk` (string)

`catalogId` = `slug(institution)#slug(academicYear)`, built by `makeCatalogId(institution, academicYear)`. Slugging is lowercase, non-alphanumeric collapsed to `-`, trimmed of leading/trailing `-`. Missing values fall back to `unknown-institution` / `unknown-year`. Example: `springfield-community-college#2025-2026`.

A catalog's metadata item and all of its course items live in the same partition, keyed off this `catalogId`.

## Item types

### 1. Metadata item — `sk = "METADATA"`

One per catalog. Written by `putCatalogMetadata`.

```
{
  catalogId: string,          // PK
  sk: "METADATA",              // SK, constant (METADATA_SK)
  status: "PROCESSING" | "EXISTS" | "FAILED",
  institution?: string,
  academicYear?: string,
  catalogTitle?: string,
  courseCount?: number,
  jobId: string,
  errorMessage?: string,
  updatedAt: string            // ISO 8601
}
```

### 2. Course item — `sk = "COURSE#<NORMALIZED_COURSE_CODE>"`

One per course, keyed by `makeCourseSk(courseCode)` → `` `COURSE#${normalizeCourseCode(courseCode)}` ``. Written in batches (25 at a time via BatchWriteItem) by `putCourses`.

`normalizeCourseCode` uppercases, collapses whitespace, and normalizes spacing around `&` (so `"ACCT&201"`, `"ACCT & 201"`, and `"ACCT &201"` all resolve to the same sort key). Any new code that builds a course lookup key must go through this function — do not construct `COURSE#<code>` keys from a raw, unnormalized course code.

Courses without an extracted code get a synthetic one: `UNCODED-<n>` (1-indexed position in the extraction batch), so they still get a stable, unique sort key instead of colliding or being dropped.

```
{
  catalogId: string,           // PK
  sk: string,                   // e.g. "COURSE#ACCT& 201"
  courseCode: string,           // normalized form, same value as in the sk suffix
  department?: string,
  courseTitle?: string,
  courseLevel?: string,
  description?: string,
  credits?: number,
  contactHours?: number,
  lectureHours?: number,
  labHours?: number,
  studioHours?: number,
  deliveryMode?: string,
  duration?: string,
  learningOutcomes?: string[],
  topics?: string[],
  competencies?: string[],
  assignments?: string[],
  assessmentMethods?: string[],
  requiredMaterials?: string[],
  transferNotes?: string[],
  sourcePages?: number[],
  updatedAt: string             // ISO 8601
}
```

All fields besides `catalogId`, `sk`, `courseCode`, and `updatedAt` are optional — extraction quality varies per catalog/page, so absence is normal and code reading these items must not assume any given field is present.

## Access patterns

| Pattern | Operation | Cost profile |
|---|---|---|
| Does catalog X exist? / what's its status? | `GetItem(PK=catalogId, SK="METADATA")` | Point read |
| Exact course lookup | `GetItem(PK=catalogId, SK="COURSE#"+normalizeCourseCode(code))` | Point read |
| List all courses in one catalog | `Query(PK=catalogId, SK begins_with "COURSE#")` | Single-partition query, cheap |
| List all catalogs | `Scan` filtered to `sk = "METADATA"` | **Full table scan** — see below |

No GSIs exist. The `listCatalogs` scan is a known weak point: it scans every item in the table (metadata + all courses across all catalogs) and discards non-metadata rows client-side. It's fine at prototype scale but degrades as course volume grows, since cost scales with total table size, not with catalog count.

## Known gaps for future work

- **List-catalogs scan.** Fix by adding a GSI that only metadata items populate (e.g. a sparse GSI keyed on a `gsiType`/constant attribute set only on metadata items), turning the scan into a Query.
- **No course search/filtering** (by department, credits, keyword, level, etc.). DynamoDB alone won't do free-text search well — either add GSIs for specific known filter fields (e.g. a `department` + `catalogId` GSI) or pair with a search index (OpenSearch, etc.) if filtering needs to be flexible.
- **No cross-catalog course lookup.** Course lookups always require knowing `catalogId` first; there's no way to search for a course code across institutions without scanning.
- **`courseCode` collisions across UNCODED entries** are avoided only by batch position (`UNCODED-<n>`), which is stable within one extraction run but not guaranteed unique if a catalog is re-extracted with a different page order/count — re-running extraction can leave orphaned `UNCODED-*` items from a prior run since `putCourses` only writes, it doesn't delete stale items first.
