import { describe, expect, it, vi } from 'vitest';
import { TranscriptApiError, TranscriptClient } from '../src/transcript/transcript-client.js';
import { normalizeTranscript } from '../src/transcript/normalize-transcript.js';
import type { TranscriptDetailDto } from '../src/domain/transcript.js';

const detail: TranscriptDetailDto = {
  id: 9,
  status: 'completed',
  student: {
    id: 41,
    student_id: ' EXT-41 ',
    full_name: ' Ada Lovelace ',
    institution: ' Summer Camp College ',
    courses: [{ id: 1, course_code: ' MATH 101 ', course_name: 'Calculus', department: 'Math', term_year: '2024-2025', year: '2022', credits: 5 }],
  },
};

describe('Transcript_API client', () => {
  it('uses status and detail routes with bearer authentication and validates responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ transcript_id: 9, status: 'completed' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        transcript_id: 9,
        status: 'completed',
        student: { ...detail.student, ignored_processor_field: 'ignored' },
      }), { status: 200 }));
    const client = new TranscriptClient({ baseUrl: 'https://processor.example/', authToken: 'secret-token', fetch });

    await expect(client.getStatus(9)).resolves.toEqual({ id: 9, status: 'completed' });
    await expect(client.getDetail(9)).resolves.toEqual(detail);
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://processor.example/status/9', expect.objectContaining({ headers: { accept: 'application/json', authorization: 'Bearer secret-token' } }));
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://processor.example/transcript/9', expect.any(Object));
  });

  it('returns sanitized errors for downstream failures and invalid response payloads', async () => {
    const failed = new TranscriptClient({ baseUrl: 'https://processor.example', fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'database password leaked' }), { status: 500 })) });
    await expect(failed.getStatus(9)).rejects.toMatchObject({ code: 'TRANSCRIPT_API_REQUEST_FAILED', message: 'Transcript request could not be completed.' });

    const malformed = new TranscriptClient({ baseUrl: 'https://processor.example', fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ transcript_id: 9, status: 'unknown' }), { status: 200 })) });
    await expect(malformed.getStatus(9)).rejects.toBeInstanceOf(TranscriptApiError);
    await expect(malformed.getStatus(9)).rejects.toMatchObject({ code: 'TRANSCRIPT_API_INVALID_RESPONSE' });
  });
});

describe('transcript normalization', () => {
  it('derives student identity, inheritance, and term-year precedence', () => {
    expect(normalizeTranscript(detail)).toEqual({
      student: { studentKey: 'transcript-processor:41', processorStudentId: 41, externalStudentId: 'EXT-41', displayName: 'Ada Lovelace' },
      takenCourses: [{ sourceCourseId: 1, courseCode: 'MATH 101', courseTitle: 'Calculus', department: 'Math', credits: 5, rawInstitution: 'Summer Camp College', rawAcademicYear: '2024-2025' }],
      excludedTakenCourses: [],
    });
  });

  it('uses the fallback name and excludes each malformed course exactly once', () => {
    const normalized = normalizeTranscript({ ...detail, student: {
      ...detail.student!, full_name: ' ', courses: [
        { id: 1, course_code: null, course_name: null, department: null, term_year: 'invalid', year: null, credits: null },
        { id: 2, course_code: 'BIO 101', course_name: null, department: null, term_year: null, year: '2023', credits: null },
      ],
    } });
    expect(normalized.student.displayName).toBe('Student 41');
    expect(normalized.takenCourses.map((course) => course.sourceCourseId)).toEqual([2]);
    expect(normalized.excludedTakenCourses).toHaveLength(1);
    expect(normalized.excludedTakenCourses[0]).toMatchObject({ takenCourse: { sourceCourseId: 1 }, reasonCode: 'MISSING_REQUIRED_IDENTIFIER' });
  });

  it('preserves the normalization partition for generated valid and invalid identifiers', () => {
    for (let id = 1; id <= 100; id += 1) {
      const institution = id % 2 === 0 ? 'College' : null;
      const code = id % 3 === 0 ? null : `COURSE ${id}`;
      const termYear = id % 5 === 0 ? 'not-a-year' : '2024';
      const normalized = normalizeTranscript({ ...detail, student: { ...detail.student!, institution, courses: [{ id, course_code: code, course_name: null, department: null, term_year: termYear, year: null, credits: null }] } });
      expect(normalized.takenCourses.length + normalized.excludedTakenCourses.length).toBe(1);
      if (institution && code && termYear === '2024') expect(normalized.takenCourses).toHaveLength(1);
      else expect(normalized.excludedTakenCourses).toHaveLength(1);
    }
  });
});
