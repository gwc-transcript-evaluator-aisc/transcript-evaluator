# Summer Camp — Transfer-Credit Articulation Platform

Summer Camp helps a receiving college decide whether the courses a student took
elsewhere satisfy the requirements of one of its degree programs. It turns a stack of
PDF transcripts and course catalogs into structured data, then uses AWS Bedrock to
reason about course equivalence — giving a human evaluator an AI-assisted, evidence-backed
recommendation for each required course instead of a manual, page-by-page comparison.

## The problem it solves

Evaluating transfer credit is slow and inconsistent. An evaluator has to read a student's
transcript, find the catalog description of each course they took, compare it against the
description of the course it might replace, and apply program and grade policies by hand —
repeated for every course, every student, every term.

Summer Camp automates the mechanical parts of that work and keeps the human in the loop
for the judgment call:

- **Read the documents.** Transcripts and course catalogs arrive as PDFs; the platform
  extracts students, courses, credits, terms, and full catalog descriptions.
- **Find the candidates.** For a chosen degree program, it matches a student's completed
  courses against the program's required courses.
- **Judge equivalence.** For each candidate pair it produces a decision
  (equivalent / partial / not equivalent), a confidence level, and a written rationale,
  grounded in the real catalog descriptions of both courses.
- **Let a human decide.** An evaluator dashboard shows the side-by-side comparison and the
  AI's reasoning, and lets the evaluator agree, override, add notes, and record a final
  decision.

## How it works

A student's evaluation flows through four stages:

1. **Transcript intake.** A transcript PDF is uploaded and processed asynchronously with
   Amazon Bedrock Data Automation against a custom transcript blueprint. The extracted
   student profile and course list are persisted, and the record is marked complete when
   extraction finishes.

2. **Catalog knowledge.** Course catalogs are extracted into a queryable store of course
   descriptions, keyed by institution and academic year. This is the source of truth the
   equivalence step reasons over, so decisions are based on real course content rather than
   course codes alone.

3. **Articulation run.** Once a transcript is ready, an orchestration workflow evaluates it
   against a selected degree program. It resolves both the required courses and the
   student's courses to their catalog descriptions, matches likely candidates, and evaluates
   each pair for equivalence. Matching and evaluation are AI steps; the workflow is durable
   and processes courses in parallel.

4. **Review.** Results are exposed per student and per run. The dashboard presents each
   required course, the matched transfer course, the side-by-side descriptions, and the AI
   decision, confidence, and rationale — with controls for the evaluator to override and
   finalize.

## Built on AWS

The platform is serverless and defined as infrastructure-as-code (AWS CDK). It uses:

- **Amazon Bedrock** — Data Automation for document extraction, and foundation models for
  course matching and equivalence assessment.
- **AWS Lambda + Step Functions** — asynchronous, durable processing of transcripts and
  articulation runs.
- **Amazon S3, DynamoDB, and Aurora PostgreSQL** — document, catalog/result, and transcript
  storage.
- **Amazon API Gateway + CloudFront/S3** — the APIs and the hosted evaluator dashboard
  (a React single-page app).

## Status

This is a working prototype. It demonstrates the end-to-end path from an uploaded transcript
to an AI-assisted articulation result, but it is not hardened for production use.

### Prototype API access (not production-safe)

The orchestrator API is protected by a single shared API key generated into AWS Secrets
Manager at deploy time; the value is intentionally never a stack output. An authorized
operator retrieves it and supplies it to the browser build as `VITE_ORCHESTRATOR_API_KEY`,
along with the API base URL as `VITE_ORCHESTRATOR_API_BASE_URL`. Because any `VITE_` value is
embedded in the browser bundle, every user of the site can extract this shared key — so it is
suitable only for this non-production prototype and must be replaced with per-user
authentication and authorization before production. Do not commit the key, place it in CDK
context, or print it in deployment logs. Local stacks (`-c local=true`) bypass API-key
verification.

## License

MIT
