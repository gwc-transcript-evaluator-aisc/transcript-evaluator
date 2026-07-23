import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../aws/clients.js';
import { CourseCatalogSchema, type Course, type CourseCatalog } from './course.js';

export interface NormalizedResult {
  schemaVersion: '1.0';
  extractedAt: string;
  catalog: CourseCatalog;
  rawOutputKey: string;
}

const fieldMap: Record<string, keyof Course> = {
  department: 'department',
  course_code: 'courseCode',
  course_title: 'courseTitle',
  course_level: 'courseLevel',
  description: 'description',
  credits: 'credits',
  contact_hours: 'contactHours',
  lecture_hours: 'lectureHours',
  lab_hours: 'labHours',
  studio_hours: 'studioHours',
  delivery_mode: 'deliveryMode',
  duration: 'duration',
  learning_outcomes: 'learningOutcomes',
  topics: 'topics',
  competencies: 'competencies',
  assignments: 'assignments',
  assessment_methods: 'assessmentMethods',
  required_materials: 'requiredMaterials',
  transfer_notes: 'transferNotes',
};

const numericFields = new Set<keyof Course>(['credits', 'contactHours', 'lectureHours', 'labHours', 'studioHours']);
// The BDA blueprint cannot express array fields inside a table row, so these are extracted
// as semicolon-delimited strings and split back into arrays here.
const listFields = new Set<keyof Course>(['learningOutcomes', 'topics', 'competencies', 'assignments', 'assessmentMethods', 'requiredMaterials', 'transferNotes']);

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.every(isBlank);
  return false;
}

function normalizeCourse(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(source).flatMap(([key, item]) => {
    const target = fieldMap[key] ?? key as keyof Course;
    if (isBlank(item)) return [];
    if (listFields.has(target)) {
      const entries = (Array.isArray(item) ? item : String(item).split(';'))
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0);
      return entries.length === 0 ? [] : [[target, entries]];
    }
    if (Array.isArray(item)) {
      const filtered = item.filter((entry) => !isBlank(entry));
      return filtered.length === 0 ? [] : [[target, filtered]];
    }
    if (numericFields.has(target) && typeof item === 'string') {
      const parsed = Number(item);
      return Number.isFinite(parsed) ? [[target, parsed]] : [];
    }
    return [[target, item]];
  }));
}

/** BDA returns empty strings ("") rather than omitting a field when it has nothing to
 * extract. The Course schema's per-field blanking is handled in normalizeCourse, but the
 * top-level catalog fields (institution, catalog_title, catalog_academic_year) need the
 * same treatment -- otherwise an empty string fails the schema's min(1) string check. */
function blankToUndefined(value: unknown): string | undefined {
  return isBlank(value) ? undefined : (value as string);
}

function coerceBdaCatalog(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const value = raw as Record<string, unknown>;
  const institution = blankToUndefined(value.institution);
  const catalogTitle = blankToUndefined(value.catalog_title);
  const catalogAcademicYear = blankToUndefined(value.catalog_academic_year);
  if (Array.isArray(value.courses)) return { institution, catalogTitle, catalogAcademicYear, courses: value.courses.map(normalizeCourse) };
  if (value.course && typeof value.course === 'object') {
    const courses = Array.isArray(value.course) ? value.course : [value.course];
    return { institution, catalogTitle, catalogAcademicYear, courses: courses.map(normalizeCourse) };
  }
  if (Array.isArray(value.course_records)) {
    const courses = value.course_records.map((record) => {
      if (typeof record !== 'string') return normalizeCourse(record);
      try {
        return normalizeCourse(JSON.parse(record) as unknown);
      } catch {
        return { description: record };
      }
    });
    return { institution, catalogTitle, catalogAcademicYear, courses };
  }
  for (const key of ['customOutput', 'custom_output', 'output', 'inference_result']) {
    if (value[key] && typeof value[key] === 'object') return coerceBdaCatalog(value[key]);
  }
  return raw;
}

export function normalizeCatalog(raw: unknown, rawOutputKey: string, now = new Date()): NormalizedResult {
  const parsed = CourseCatalogSchema.parse(coerceBdaCatalog(raw));
  return { schemaVersion: '1.0', extractedAt: now.toISOString(), catalog: parsed, rawOutputKey };
}

function parseBucketAndKey(s3Uri: string): { bucket: string; key: string } {
  const withoutScheme = s3Uri.replace(/^s3:\/\//, '');
  const [bucket, ...rest] = withoutScheme.split('/');
  return { bucket, key: rest.join('/') };
}

async function getJsonObject(bucket: string, key: string): Promise<unknown> {
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await object.Body?.transformToString();
  return body ? JSON.parse(body) : undefined;
}

/** Reads a single page's BDA custom-output JSON from S3 and returns its normalized,
 * schema-validated catalog (institution/title/year plus that page's courses). BDA's
 * GetDataAutomationStatus returns `outputConfiguration.s3Uri` pointing at that
 * invocation's job_metadata.json (a specific file, not a listable prefix), which in turn
 * points at the actual per-segment custom_output path -- so we follow that indirection
 * rather than trying to derive the output path ourselves. */
export async function extractPageCourses(jobMetadataS3Uri: string | undefined): Promise<CourseCatalog> {
  const empty: CourseCatalog = { courses: [] };
  if (!jobMetadataS3Uri) return empty;
  const { bucket, key } = parseBucketAndKey(jobMetadataS3Uri);
  const metadata = await getJsonObject(bucket, key) as {
    output_metadata?: Array<{ segment_metadata?: Array<{ custom_output_path?: string; custom_output_status?: string }> }>;
  } | undefined;
  const segments = metadata?.output_metadata?.flatMap((asset) => asset.segment_metadata ?? []) ?? [];
  const outputPaths = segments
    .filter((segment) => segment.custom_output_status !== 'NO_MATCH')
    .map((segment) => segment.custom_output_path)
    .filter((path): path is string => Boolean(path));
  if (outputPaths.length === 0) return empty;

  const catalogs = await Promise.all(outputPaths.map(async (path) => {
    const { bucket: outputBucket, key: outputKey } = parseBucketAndKey(path);
    const raw = await getJsonObject(outputBucket, outputKey);
    if (raw === undefined) return undefined;
    return normalizeCatalog(raw, outputKey).catalog;
  }));

  const valid = catalogs.filter((catalog): catalog is CourseCatalog => Boolean(catalog));
  if (valid.length === 0) return empty;
  return {
    institution: valid.find((catalog) => catalog.institution)?.institution,
    catalogTitle: valid.find((catalog) => catalog.catalogTitle)?.catalogTitle,
    catalogAcademicYear: valid.find((catalog) => catalog.catalogAcademicYear)?.catalogAcademicYear,
    courses: valid.flatMap((catalog) => catalog.courses),
  };
}
