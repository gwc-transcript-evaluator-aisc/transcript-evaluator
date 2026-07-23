import { describe, expect, it } from 'vitest';
import { normalizeCatalog } from '../src/domain/normalize.js';

describe('normalizeCatalog', () => {
  it('preserves sparse course data and adds a version', () => {
    const result = normalizeCatalog({ courses: [{ courseCode: 'ENG 101', description: 'Writing.' }] }, 'bda/job/output.json', new Date('2025-01-01T00:00:00.000Z'));
    expect(result.schemaVersion).toBe('1.0');
    expect(result.catalog.courses[0].courseCode).toBe('ENG 101');
    expect(result.extractedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('treats an empty-string institution/title/year as absent rather than failing schema validation', () => {
    // BDA returns "" (not omitted) when it has nothing to extract for a field.
    const result = normalizeCatalog({
      institution: '',
      catalog_title: '',
      catalog_academic_year: '',
      courses: [{ course_code: 'ACCT 206' }],
    }, 'bda/job/output.json');
    expect(result.catalog.institution).toBeUndefined();
    expect(result.catalog.catalogTitle).toBeUndefined();
    expect(result.catalog.catalogAcademicYear).toBeUndefined();
    expect(result.catalog.courses[0].courseCode).toBe('ACCT 206');
  });
});
