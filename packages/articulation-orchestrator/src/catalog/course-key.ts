/** Normalized components mirror the Catalog table's stable identifier format. */
export function normalizeInstitution(institution: string): string {
  return institution.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function normalizeAcademicYear(academicYear: string): string {
  return academicYear.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function makeCatalogKey(institution: string, academicYear: string): string {
  return `${normalizeInstitution(institution)}#${normalizeAcademicYear(academicYear)}`;
}

export function normalizeCourseCode(courseCode: string): string {
  return courseCode.trim().toUpperCase().replace(/\s+/g, ' ').replace(/\s*&\s*/g, '& ').replace(/\s+/g, ' ').trim();
}

export function makeCourseKey(courseCode: string): string {
  return `COURSE#${normalizeCourseCode(courseCode)}`;
}
