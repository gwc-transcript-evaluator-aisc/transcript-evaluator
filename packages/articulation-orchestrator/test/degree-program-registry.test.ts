import { describe, expect, it } from 'vitest';
import { DegreeProgramRegistrySchema, RequiredCourseSchema } from '../src/domain/degree-program.js';
import { getDegreeProgram, listDegreePrograms } from '../src/degree-programs/registry-service.js';

describe('degree program schemas and registry', () => {
  it('requires a non-blank course code', () => {
    expect(() => RequiredCourseSchema.parse({
      institution: 'Summer Camp Community College',
      academicYear: '2024-2025',
      courseCode: '   ',
    })).toThrow();
  });

  it('rejects requirements duplicated after normalization', () => {
    expect(() => DegreeProgramRegistrySchema.parse([{
      id: 'test-program',
      name: 'Test Program',
      requiredCourses: [
        { institution: 'Example College', academicYear: '2024-2025', courseCode: 'cs 101' },
        { institution: ' example   college ', academicYear: '2024-2025', courseCode: ' CS 101 ' },
      ],
    }])).toThrow(/unique after normalization/);
  });

  it('rejects duplicate program identifiers', () => {
    const program = { id: 'test-program', name: 'Test Program', requiredCourses: [] };
    expect(() => DegreeProgramRegistrySchema.parse([program, program])).toThrow(/identifiers must be unique/);
  });

  it('lists complete programs and returns a defined not-found outcome', () => {
    const [program] = listDegreePrograms();
    expect(program.requiredCourses).toHaveLength(2);
    expect(getDegreeProgram(program.id)).toEqual({ kind: 'found', program });
    expect(getDegreeProgram('unknown-program')).toEqual({ kind: 'not-found', degreeProgramId: 'unknown-program' });
  });
});
