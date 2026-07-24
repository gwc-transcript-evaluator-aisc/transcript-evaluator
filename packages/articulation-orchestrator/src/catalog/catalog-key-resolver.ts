import type { CatalogResolution, CourseIdentifier, ResolutionMethod } from '../domain/catalog-resolution.js';
import { makeCatalogKey, normalizeInstitution } from './course-key.js';
import type { CatalogDirectory, CatalogDirectoryRecord } from './catalog-cache-store.js';

export interface InstitutionResolver {
  resolveInstitution(input: { institution: string; knownInstitutions: string[] }): Promise<string | 'none'>;
}

export interface CatalogResolutionInput {
  institution?: string;
  academicYear?: string;
  courseCode?: string;
}

export interface ResolvedCatalogCourse {
  resolution: CatalogResolution;
  identifier?: CourseIdentifier;
}

/** Resolves keys in the required order: raw exact, normalized exact institution, then AI. */
export class CatalogKeyResolver {
  public constructor(private readonly institutionResolver: InstitutionResolver) {}

  public async resolve(input: CatalogResolutionInput, directory: CatalogDirectory): Promise<ResolvedCatalogCourse> {
    const original = { institution: input.institution, academicYear: input.academicYear };
    if (!input.institution || !input.academicYear || !input.courseCode) {
      return unresolved(original, 'INVALID_CATALOG_IDENTIFIER', 'Course does not contain a usable catalog identifier.');
    }

    const usable: Required<CatalogResolutionInput> = {
      institution: input.institution,
      academicYear: input.academicYear,
      courseCode: input.courseCode,
    };
    const exactKey = makeCatalogKey(usable.institution, usable.academicYear);
    const exact = directory.institutions.find((entry) => entry.catalogKeys.includes(exactKey));
    if (exact) return resolved(usable, exact.institution, usable.academicYear, 'exact');

    const normalized = normalizeInstitution(usable.institution);
    let institution = directory.institutions.find((entry) => entry.normalizedInstitution === normalized);
    let aiSelected = false;
    if (!institution) {
      const selected = await this.institutionResolver.resolveInstitution({
        institution: input.institution,
        knownInstitutions: directory.institutions.map((entry) => entry.institution),
      });
      if (selected === 'none') return unresolved(original, 'INSTITUTION_NOT_FOUND', 'No matching catalog institution is available.');
      institution = directory.institutions.find((entry) => entry.institution === selected);
      if (!institution) return unresolved(original, 'INSTITUTION_NOT_FOUND', 'No matching catalog institution is available.');
      aiSelected = true;
    }

    const academicYear = institution.academicYears.includes(input.academicYear)
      ? input.academicYear
      : latestYear(institution.academicYears);
    if (!academicYear) return unresolved(original, 'CATALOG_YEAR_NOT_FOUND', 'No catalog year is available for the resolved institution.');
    const method: ResolutionMethod = aiSelected
      ? (academicYear === input.academicYear ? 'ai-institution' : 'ai-institution-year-fallback')
      : 'exact-institution-year-fallback';
    return resolved(usable, institution.institution, academicYear, method);
  }
}

function resolved(input: Required<CatalogResolutionInput>, institution: string, academicYear: string, method: ResolutionMethod): ResolvedCatalogCourse {
  const identifier = { institution, academicYear, courseCode: input.courseCode };
  return { resolution: { kind: 'resolved', original: { institution: input.institution, academicYear: input.academicYear }, resolved: { institution, academicYear }, method }, identifier };
}

function unresolved(original: { institution?: string; academicYear?: string }, reasonCode: string, message: string): ResolvedCatalogCourse {
  return { resolution: { kind: 'unresolved', original, reasonCode, message } };
}

function latestYear(years: string[]): string | undefined {
  return years.reduce<string | undefined>((latest, year) => {
    const end = Number(year.split('-').at(-1));
    if (!Number.isInteger(end)) return latest;
    if (!latest || end > Number(latest.split('-').at(-1))) return year;
    return latest;
  }, undefined);
}

export function catalogDirectoryRecord(institution: string, academicYears: string[]): CatalogDirectoryRecord {
  return { pk: 'test', sk: `INSTITUTION#${normalizeInstitution(institution)}`, snapshotId: 'test', institution, normalizedInstitution: normalizeInstitution(institution), academicYears, catalogKeys: academicYears.map((year) => makeCatalogKey(institution, year)), updatedAt: '2025-01-01T00:00:00.000Z' };
}
