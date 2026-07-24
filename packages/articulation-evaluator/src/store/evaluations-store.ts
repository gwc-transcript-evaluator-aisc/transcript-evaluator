import { randomUUID } from 'node:crypto';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { dynamo } from '../aws/clients.js';
import { config } from '../config.js';
import type { ArticulationAssessment, CourseIdentifier, EvaluationRecord } from '../domain/evaluation.js';
import { makeCatalogId, makeCourseSk } from '../domain/course-key.js';
import type { CourseRecord } from '../domain/course-record.js';

/** Deterministic key for a course pair, independent of evaluationId, so repeat
 * evaluations of the same home/transfer pair can be found without a scan. Every
 * invocation still writes a brand-new item (append-only history) -- this is only a
 * lookup attribute, not the table's primary key. */
export function makePairKey(home: CourseIdentifier, transfer: CourseIdentifier): string {
  const homeKey = `${makeCatalogId(home.institution, home.academicYear)}#${makeCourseSk(home.courseCode)}`;
  const transferKey = `${makeCatalogId(transfer.institution, transfer.academicYear)}#${makeCourseSk(transfer.courseCode)}`;
  return `${homeKey}__${transferKey}`;
}

export async function putEvaluation(input: {
  home: CourseIdentifier;
  transfer: CourseIdentifier;
  homeCourse: CourseRecord;
  transferCourse: CourseRecord;
  assessment: ArticulationAssessment;
  modelId: string;
}): Promise<EvaluationRecord> {
  const record: EvaluationRecord = {
    evaluationId: randomUUID(),
    pairKey: makePairKey(input.home, input.transfer),
    home: input.home,
    transfer: input.transfer,
    homeCourse: input.homeCourse,
    transferCourse: input.transferCourse,
    assessment: input.assessment,
    modelId: input.modelId,
    createdAt: new Date().toISOString(),
  };
  const doc = DynamoDBDocumentClient.from(dynamo);
  await doc.send(new PutCommand({ TableName: config.evaluationsTable, Item: record }));
  return record;
}
