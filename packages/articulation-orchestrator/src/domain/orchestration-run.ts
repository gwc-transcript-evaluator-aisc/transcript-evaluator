import { z } from 'zod';

export const OrchestrationRunStatusSchema = z.enum(['pending', 'matching', 'evaluating', 'completed', 'failed']);
export type OrchestrationRunStatus = z.infer<typeof OrchestrationRunStatusSchema>;

export const FailedStageSchema = z.enum(['starting', 'matching', 'evaluating', 'persisting']);
export type FailedStage = z.infer<typeof FailedStageSchema>;

export const ResultLocatorSchema = z.object({
  resultKey: z.string().min(1),
  resultSortKey: z.string().min(1),
}).strict();
export type ResultLocator = z.infer<typeof ResultLocatorSchema>;

export const OrchestrationRunSchema = z.object({
  runId: z.string().uuid(),
  requestId: z.string().uuid(),
  transcriptId: z.number().int().positive(),
  degreeProgramId: z.string().trim().min(1).max(200),
  status: OrchestrationRunStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  failedStage: FailedStageSchema.optional(),
  failureCode: z.string().trim().min(1).max(100).optional(),
  failureMessage: z.string().trim().min(1).max(500).optional(),
  resultLocator: ResultLocatorSchema.optional(),
}).strict().superRefine((run, context) => {
  if (run.runId !== run.requestId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['runId'], message: 'runId must equal requestId' });
  }
  if (run.status === 'failed' && !run.failedStage) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['failedStage'], message: 'Failed runs require failedStage' });
  }
  if (run.status === 'completed' && !run.resultLocator) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['resultLocator'], message: 'Completed runs require a result locator' });
  }
});
export type OrchestrationRun = z.infer<typeof OrchestrationRunSchema>;
