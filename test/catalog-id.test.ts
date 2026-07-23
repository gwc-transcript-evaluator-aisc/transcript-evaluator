import { describe, expect, it } from 'vitest';
import { makeCatalogId } from '../src/domain/course.js';

describe('makeCatalogId', () => {
  it('produces a stable slug for institution + academic year', () => {
    expect(makeCatalogId('South Puget Sound Community College', '2025-2026')).toBe('south-puget-sound-community-college#2025-2026');
  });

  it('is stable across re-processing of the same catalog', () => {
    const first = makeCatalogId('SPSCC', '2025-2026');
    const second = makeCatalogId('SPSCC', '2025-2026');
    expect(first).toBe(second);
  });

  it('falls back gracefully when institution or year is missing', () => {
    expect(makeCatalogId(undefined, undefined)).toBe('unknown-institution#unknown-year');
  });
});
