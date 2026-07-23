import { describe, expect, it } from 'vitest';
import bdaSchema from '../blueprints/course-catalog-schema.json' with { type: 'json' };
import { CourseCatalogSchema } from '../src/domain/course.js';

describe('course catalog contract', () => {
  it('accepts a sparse articulation-focused catalog', () => {
    const result = CourseCatalogSchema.parse({
      institution: 'Example College',
      courses: [{
        courseCode: 'BIO 101',
        courseTitle: 'Biology',
        description: 'An introduction to biological systems.',
        topics: ['Cell structure'],
      }],
    });
    expect(result.courses).toHaveLength(1);
  });

  it('does not define a prerequisite extraction field', () => {
    expect(Object.keys(bdaSchema.properties).some((key) => key.toLowerCase().includes('prerequisite'))).toBe(false);
  });

  it('uses the BDA blueprint structure and supported field types', () => {
    expect(bdaSchema.class).toBe('Academic Course Catalog');
    expect(bdaSchema.properties.courses.type).toBe('array');
    expect(bdaSchema.properties.courses.items.$ref).toBe('#/definitions/Course');
    for (const field of Object.values(bdaSchema.properties)) {
      if ('$ref' in field) continue;
      expect(['string', 'number', 'boolean', 'array']).toContain(field.type);
      if ('inferenceType' in field) expect(['explicit', 'inferred']).toContain(field.inferenceType);
      expect(field.instruction.length).toBeGreaterThan(0);
    }
  });

  it('does not nest array fields inside the Course table row (unsupported by BDA)', () => {
    for (const field of Object.values(bdaSchema.definitions.Course.properties)) {
      expect(field.type).not.toBe('array');
    }
  });
});
