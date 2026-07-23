import { describe, expect, it } from 'vitest';
import { normalizeCourseCode } from '../src/domain/course.js';

describe('normalizeCourseCode', () => {
  it('unifies ampersand spacing variants', () => {
    expect(normalizeCourseCode('ACCT& 201')).toBe('ACCT& 201');
    expect(normalizeCourseCode('ACCT&201')).toBe('ACCT& 201');
    expect(normalizeCourseCode('ACCT & 201')).toBe('ACCT& 201');
    expect(normalizeCourseCode('acct&  201')).toBe('ACCT& 201');
  });

  it('leaves codes without an ampersand unaffected aside from case/whitespace', () => {
    expect(normalizeCourseCode('acct 206')).toBe('ACCT 206');
    expect(normalizeCourseCode('  ACCT   206  ')).toBe('ACCT 206');
  });
});
