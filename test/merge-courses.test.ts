import { describe, expect, it } from 'vitest';
import { mergeCourses } from '../src/api/status.js';

describe('mergeCourses', () => {
  it('drops courses with no course code and no title', () => {
    const result = mergeCourses([
      { courseCode: 'ACCT 206', courseTitle: 'General Ledger', sourcePages: [1] },
      { sourcePages: [7] }, // fully-blank placeholder, same shape as the UNCODED-* records
      { description: 'orphaned text with no identifying fields', sourcePages: [9] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].courseCode).toBe('ACCT 206');
  });

  it('keeps a course identified only by title (no code)', () => {
    const result = mergeCourses([{ courseTitle: 'Intro to Something', sourcePages: [3] }]);
    expect(result).toHaveLength(1);
    expect(result[0].courseTitle).toBe('Intro to Something');
  });

  it('merges duplicate course codes across pages and unions their source pages', () => {
    const result = mergeCourses([
      { courseCode: 'ACCT 206', description: 'Intro text', sourcePages: [7] },
      { courseCode: 'ACCT 206', credits: 5, sourcePages: [8] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].credits).toBe(5);
    expect(result[0].description).toBe('Intro text');
    expect(result[0].sourcePages).toEqual([7, 8]);
  });

  it('does not collide two different uncoded courses with each other', () => {
    const result = mergeCourses([
      { courseTitle: 'First Uncoded Course' },
      { courseTitle: 'Second Uncoded Course' },
    ]);
    expect(result).toHaveLength(2);
  });
});
