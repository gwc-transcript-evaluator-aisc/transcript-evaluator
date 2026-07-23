import { describe, expect, it } from 'vitest';
import { mergeCourses } from '../src/tasks/finalize-catalog-task.js';

describe('mergeCourses', () => {
  it('drops courses with no course code and no title', () => {
    const result = mergeCourses([
      { courseCode: 'ACCT 206', courseTitle: 'General Ledger', description: 'Intro text', sourcePages: [1] },
      { sourcePages: [7] }, // fully-blank placeholder, same shape as the UNCODED-* records
      { description: 'orphaned text with no identifying fields', sourcePages: [9] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].courseCode).toBe('ACCT 206');
  });

  it('drops courses with a code/title but no description (e.g. a "Courses by Quarter" program schedule row)', () => {
    const result = mergeCourses([
      { courseCode: 'ACCT& 201', courseTitle: 'Principles of Accounting I', credits: 5, sourcePages: [3] }, // schedule table row, no description
      { courseCode: 'ACCT 231', courseTitle: 'Intermediate Accounting I', description: 'Examines the conceptual framework of accounting.', credits: 5, sourcePages: [12] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].courseCode).toBe('ACCT 231');
  });

  it('keeps a course identified only by title (no code) as long as it has a description', () => {
    const result = mergeCourses([{ courseTitle: 'Intro to Something', description: 'A description.', sourcePages: [3] }]);
    expect(result).toHaveLength(1);
    expect(result[0].courseTitle).toBe('Intro to Something');
  });

  it('merges duplicate course codes across pages and unions their source pages', () => {
    const result = mergeCourses([
      { courseCode: 'ACCT 206', description: 'Intro text', sourcePages: [7] },
      { courseCode: 'ACCT 206', description: 'Intro text', credits: 5, sourcePages: [8] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].credits).toBe(5);
    expect(result[0].description).toBe('Intro text');
    expect(result[0].sourcePages).toEqual([7, 8]);
  });

  it('does not collide two different uncoded courses with each other', () => {
    const result = mergeCourses([
      { courseTitle: 'First Uncoded Course', description: 'First description.' },
      { courseTitle: 'Second Uncoded Course', description: 'Second description.' },
    ]);
    expect(result).toHaveLength(2);
  });

  it('a schedule-table row for a course is dropped entirely even when the real entry for the same code also appears', () => {
    // The schedule table lists ACCT& 201 with credits but no description; the real
    // catalog entry for ACCT& 201 elsewhere has the description. The schedule row is
    // filtered out before merging (no description), so only the real entry survives --
    // its own fields (credits, if it has any) are used as-is, not backfilled from the
    // discarded schedule row.
    const result = mergeCourses([
      { courseCode: 'ACCT& 201', courseTitle: 'Principles of Accounting I', description: 'Examines the basic structure of accounting.', credits: 5, sourcePages: [45] },
      { courseCode: 'ACCT& 201', courseTitle: 'Principles of Accounting I', credits: 5, sourcePages: [3] }, // schedule row, no description -- dropped
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('Examines the basic structure of accounting.');
    expect(result[0].credits).toBe(5);
    expect(result[0].sourcePages).toEqual([45]);
  });
});
