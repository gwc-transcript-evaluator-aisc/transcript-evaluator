/**
 * Mirrors the key-building helpers in
 * `packages/course-catalog-api/src/domain/course.ts`. Duplicated here (rather than
 * imported across packages) because course-catalog-api owns the Catalog table's schema
 * and isn't published as a library -- these functions must stay byte-for-byte identical
 * to that source of truth for lookups to hit the right items. If they ever drift, course
 * lookups from this package will silently miss.
 */

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

/** Stable key for an institution + academic year, matching course-catalog-api's
 * makeCatalogId exactly. */
export function makeCatalogId(institution: string, academicYear: string): string {
  return `${slugify(institution)}#${slugify(academicYear)}`;
}

/** Normalizes a course code for use as a lookup key, matching course-catalog-api's
 * normalizeCourseCode exactly. */
export function normalizeCourseCode(courseCode: string): string {
  return courseCode
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*&\s*/g, '& ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sort key for a course item within the Catalog table's single-table design, matching
 * course-catalog-api's makeCourseSk exactly. */
export function makeCourseSk(courseCode: string): string {
  return `COURSE#${normalizeCourseCode(courseCode)}`;
}
