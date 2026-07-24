import { describe, expect, it } from 'vitest';
import { makeCatalogId, makeCourseSk, normalizeCourseCode } from '../src/domain/course-key.js';

describe('makeCatalogId', () => {
  it('produces a stable slug for institution + academic year, matching course-catalog-api', () => {
    expect(makeCatalogId('South Puget Sound Community College', '2025-2026')).toBe('south-puget-sound-community-college#2025-2026');
  });

  it('is stable across repeated calls', () => {
    expect(makeCatalogId('SPSCC', '2025-2026')).toBe(makeCatalogId('SPSCC', '2025-2026'));
  });
});

describe('normalizeCourseCode', () => {
  it('unifies ampersand spacing variants', () => {
    expect(normalizeCourseCode('ACCT&201')).toBe('ACCT& 201');
    expect(normalizeCourseCode('ACCT & 201')).toBe('ACCT& 201');
  });

  it('leaves codes without an ampersand unaffected aside from case/whitespace', () => {
    expect(normalizeCourseCode('  acct   206  ')).toBe('ACCT 206');
  });
});

describe('makeCourseSk', () => {
  it('prefixes the normalized code with COURSE#', () => {
    expect(makeCourseSk('acct&201')).toBe('COURSE#ACCT& 201');
  });
});
