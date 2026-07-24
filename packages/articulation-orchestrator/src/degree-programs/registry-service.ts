import { DegreeProgramRegistrySchema, type DegreeProgram } from '../domain/degree-program.js';
import { degreeProgramRegistryData } from '../domain/degree-program-registry.data.js';

/** Validated eagerly so an invalid committed registry fails during module loading. */
const loadedRegistry = DegreeProgramRegistrySchema.parse(degreeProgramRegistryData);
const programsById = new Map(loadedRegistry.map((program) => [program.id, program]));

export type DegreeProgramLookup =
  | { kind: 'found'; program: DegreeProgram }
  | { kind: 'not-found'; degreeProgramId: string };

export function listDegreePrograms(): readonly DegreeProgram[] {
  return loadedRegistry;
}

export function getDegreeProgram(degreeProgramId: string): DegreeProgramLookup {
  const program = programsById.get(degreeProgramId);
  return program
    ? { kind: 'found', program }
    : { kind: 'not-found', degreeProgramId };
}
