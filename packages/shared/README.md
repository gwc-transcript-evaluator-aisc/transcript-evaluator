# @summer-camp/shared

Shared types, utilities, and domain models for Summer Camp packages.

## Purpose

This package provides common code shared across multiple Summer Camp services:

- **Domain Types**: Course, Catalog, Institution, Academic Year
- **Validation Schemas**: Zod schemas for data validation
- **Utilities**: Normalization, formatting, and helper functions
- **Constants**: Shared enums and constant values

## Usage

### In Another Workspace Package

```json
{
  "dependencies": {
    "@summer-camp/shared": "*"
  }
}
```

```typescript
import { Course, normalizeCourseCode } from '@summer-camp/shared';

const course: Course = {
  courseCode: 'CS 101',
  // ...
};
```

## Development

```bash
# Build
npm run build

# Test
npm run test

# Lint
npm run lint
```

## Migration Plan

Future work includes migrating shared types from `course-catalog-api`:
- Course types and schemas
- Catalog types and schemas
- Normalization utilities (course codes, slugs)
- Common validation logic
