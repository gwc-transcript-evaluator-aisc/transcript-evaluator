# Requirements Document

## Introduction

The Course Catalog Extraction API is a standalone HTTP API for submitting a school course-catalog PDF, retaining the source PDF in Amazon S3, and requesting Amazon Bedrock Data Automation extraction. The API produces adaptable, articulation-oriented course-outline records from catalogs with different layouts and incomplete field coverage. The API does not depend on existing application projects, schemas, or deployment directories in the workspace.

The API uses an asynchronous extraction job so that callers can submit catalogs larger than a single request-response processing window, monitor progress, and retrieve a normalized result or a structured failure.

## Glossary

- **Course_Catalog_Extraction_API**: The standalone HTTP API specified by this document.
- **Catalog_PDF**: A school course-catalog document supplied as a PDF upload.
- **Extraction_Job**: A server-side record representing one accepted Catalog_PDF submission and its extraction lifecycle.
- **Authenticated_Caller**: A caller that satisfies the API authentication and authorization policy.
- **S3_Object**: The private Amazon S3 object containing the uploaded Catalog_PDF.
- **Bedrock_Data_Automation**: Amazon Bedrock Data Automation configured to analyze the Catalog_PDF and return structured document extraction data.
- **Course_Record**: A normalized record representing one course identified in a Catalog_PDF.
- **Course_Outline**: The adaptable set of articulation-relevant fields associated with a Course_Record.
- **Canonical_Field**: A normalized Course_Outline field with a stable name and documented value type.
- **Source_Evidence**: A page reference and text or bounding-region evidence supporting an extracted value.
- **Extraction_Result**: The normalized response containing Course_Record values, Source_Evidence, warnings, and processing metadata.
- **Extraction_Status**: The lifecycle state of an Extraction_Job: `queued`, `processing`, `succeeded`, `failed`, or `expired`.
- **Structured_Error**: A JSON error object containing a stable error code, human-readable message, request correlation identifier, and optional field details.
- **Idempotency_Key**: A caller-provided value used to associate retries of the same submission with one Extraction_Job.
- **Configurable_Limit**: An operational limit supplied through deployment configuration rather than hard-coded client behavior.
- **Confidence_Score**: A numeric extraction-confidence value in the inclusive range 0.0 through 1.0 when Bedrock_Data_Automation supplies a confidence value.
- **Sensitive_Data**: Credentials, authorization material, personal identifiers, or document content that must not appear in ordinary application logs.
- **Retention_Period**: The configured duration for retaining an S3_Object, Extraction_Result, and Extraction_Job metadata.

## Requirements

### Requirement 1: Submit a catalog extraction job

**User Story:** As an articulation-system integrator, I want to submit a catalog PDF through a stable API contract, so that catalog processing can begin without coupling to an existing application.

#### Acceptance Criteria

1. WHEN an Authenticated_Caller submits a valid Catalog_PDF with a supported content type and size within the Configurable_Limit, THE Course_Catalog_Extraction_API SHALL create one Extraction_Job and return HTTP status `202` with a server-generated job identifier, `queued` Extraction_Status, status URL, and request correlation identifier.
2. WHEN an Authenticated_Caller submits a valid Catalog_PDF, THE Course_Catalog_Extraction_API SHALL accept the upload as a binary PDF payload without requiring a particular catalog layout, page orientation, school, or publisher.
3. WHEN an Authenticated_Caller omits a required upload part or request field, THE Course_Catalog_Extraction_API SHALL return HTTP status `400` with a Structured_Error identifying the missing request element.
4. WHEN an unauthenticated or unauthorized caller submits a Catalog_PDF, THE Course_Catalog_Extraction_API SHALL return HTTP status `401` or `403` with a Structured_Error that does not disclose authorization policy details.
5. WHEN an Authenticated_Caller submits a request with an Idempotency_Key that matches a previously accepted equivalent submission, THE Course_Catalog_Extraction_API SHALL return the existing Extraction_Job identifier and current Extraction_Status without creating a second Extraction_Job.
6. WHEN an Authenticated_Caller submits a request with an Idempotency_Key that conflicts with a different submission, THE Course_Catalog_Extraction_API SHALL return HTTP status `409` with a Structured_Error.

### Requirement 2: Validate and retain the source PDF

**User Story:** As a platform operator, I want source uploads validated and privately retained, so that extraction receives an authentic document and the source remains available for audit.

#### Acceptance Criteria

1. WHEN the upload payload does not contain a PDF file signature, THE Course_Catalog_Extraction_API SHALL reject the payload with HTTP status `415` and a Structured_Error using a stable unsupported-media error code.
2. WHEN the upload payload exceeds the configured maximum byte size, THE Course_Catalog_Extraction_API SHALL reject the payload with HTTP status `413` and a Structured_Error containing the configured limit category.
3. WHEN the upload payload contains a syntactically invalid or unreadable PDF, THE Course_Catalog_Extraction_API SHALL reject the payload with HTTP status `422` and a Structured_Error using a stable invalid-document error code.
4. WHEN a Catalog_PDF passes upload validation, THE Course_Catalog_Extraction_API SHALL store exactly one S3_Object under a server-generated non-sensitive object key before invoking Bedrock_Data_Automation.
5. WHEN a Catalog_PDF passes upload validation, THE Course_Catalog_Extraction_API SHALL associate the S3_Object location with the Extraction_Job without returning bucket names, object keys, or credentials to the Authenticated_Caller.
6. WHEN S3 storage fails before Bedrock_Data_Automation invocation, THE Course_Catalog_Extraction_API SHALL mark the Extraction_Job as `failed`, return or expose a Structured_Error with a dependency-failure code, and avoid invoking Bedrock_Data_Automation for the unavailable S3_Object.

### Requirement 3: Invoke and monitor asynchronous extraction

**User Story:** As an articulation-system integrator, I want predictable asynchronous processing and status reporting, so that a client can handle catalogs that require variable processing time.

#### Acceptance Criteria

1. WHEN an Extraction_Job is accepted, THE Course_Catalog_Extraction_API SHALL invoke Bedrock_Data_Automation with the associated S3_Object and the configured course-catalog extraction contract.
2. WHILE an Extraction_Job is awaiting work or being processed, THE Course_Catalog_Extraction_API SHALL expose the current Extraction_Status as `queued` or `processing` through the job-status endpoint.
3. WHEN Bedrock_Data_Automation completes successfully, THE Course_Catalog_Extraction_API SHALL persist an Extraction_Result, set Extraction_Status to `succeeded`, and expose a result retrieval URL through the job-status endpoint.
4. WHEN Bedrock_Data_Automation returns a terminal failure, THE Course_Catalog_Extraction_API SHALL set Extraction_Status to `failed` and expose a Structured_Error with a stable extraction-failure code and request correlation identifier.
5. WHEN an Extraction_Job exceeds the configured processing timeout, THE Course_Catalog_Extraction_API SHALL stop treating the job as active, set Extraction_Status to `failed`, and expose a timeout Structured_Error.
6. WHEN an Authenticated_Caller requests a job identifier that does not exist or is not authorized for the caller, THE Course_Catalog_Extraction_API SHALL return HTTP status `404` with a Structured_Error that does not reveal whether another caller owns the identifier.
7. WHEN an Authenticated_Caller requests a completed Extraction_Job result, THE Course_Catalog_Extraction_API SHALL return HTTP status `200` with the Extraction_Result and a stable result schema.
8. WHEN an Authenticated_Caller requests a result for an Extraction_Job that is not complete, THE Course_Catalog_Extraction_API SHALL return HTTP status `409` with the current Extraction_Status and a Structured_Error.

### Requirement 4: Produce adaptable course records

**User Story:** As an articulation analyst, I want catalog content normalized into course records with optional fields, so that records remain useful across institutions and catalog layouts.

#### Acceptance Criteria

1. WHEN Bedrock_Data_Automation identifies one or more courses, THE Course_Catalog_Extraction_API SHALL return one Course_Record for each distinct course supported by Source_Evidence.
2. WHEN a Course_Record contains a source value for course code or course number, THE Course_Catalog_Extraction_API SHALL preserve the source value in the `course_code` or `course_number` Canonical_Field without requiring a fixed alphanumeric format.
3. WHEN a Course_Record contains a source value for course title, THE Course_Catalog_Extraction_API SHALL return the value in the `title` Canonical_Field as source text with surrounding layout artifacts removed.
4. WHEN a Course_Record contains a source value for course description, THE Course_Catalog_Extraction_API SHALL return the value in the `description` Canonical_Field without replacing source meaning with a generated summary.
5. WHEN a Course_Record contains source values for credits, learning outcomes, topics, contact hours, grading or evaluation, materials, or textbooks, THE Course_Catalog_Extraction_API SHALL return each available value in the corresponding Canonical_Field with the documented value type.
6. WHEN a Course_Record contains an articulation-relevant source field not represented by a required Canonical_Field, THE Course_Catalog_Extraction_API SHALL preserve the field in an `additional_fields` collection with a source label, normalized value, and Source_Evidence.
7. WHEN a Catalog_PDF contains repeated listings for the same course, THE Course_Catalog_Extraction_API SHALL consolidate listings into one Course_Record when course identity and Source_Evidence support consolidation.
8. WHEN a Catalog_PDF contains multiple sections or layout styles, THE Course_Catalog_Extraction_API SHALL process all supported pages and return Course_Record values without requiring a single repeated page template.

### Requirement 5: Represent missing, uncertain, and unsupported data safely

**User Story:** As an articulation analyst, I want absent or uncertain data represented explicitly, so that downstream users can distinguish missing catalog information from extraction failure.

#### Acceptance Criteria

1. WHEN a Catalog_PDF does not contain a Canonical_Field for a Course_Record, THE Course_Catalog_Extraction_API SHALL represent the field as `null` or an empty collection according to the field schema and SHALL include the field in `missing_fields`.
2. WHEN Bedrock_Data_Automation cannot determine a value reliably, THE Course_Catalog_Extraction_API SHALL omit unsupported value assertions, include the field in `uncertain_fields`, and include a warning in the Extraction_Result.
3. WHEN a returned value has a Confidence_Score, THE Course_Catalog_Extraction_API SHALL include the Confidence_Score and associated Source_Evidence for the value.
4. WHEN a returned value lacks a provider Confidence_Score, THE Course_Catalog_Extraction_API SHALL omit the Confidence_Score rather than inventing a numeric confidence value.
5. WHEN a Catalog_PDF contains no identifiable course listing, THE Course_Catalog_Extraction_API SHALL complete the Extraction_Job with `succeeded`, return an empty Course_Record collection, and include a no-courses-found warning.
6. WHEN a Catalog_PDF contains a course with only a subset of Course_Outline fields, THE Course_Catalog_Extraction_API SHALL return the available subset and shall not fail the complete Extraction_Job solely because optional fields are absent.
7. WHEN a source value cannot be mapped to a Canonical_Field without changing source meaning, THE Course_Catalog_Extraction_API SHALL preserve the value in `additional_fields` or `unmapped_fields` with Source_Evidence.

### Requirement 6: Preserve evidence and extraction provenance

**User Story:** As an articulation reviewer, I want to inspect where extracted values came from, so that catalog-derived records can be verified before articulation decisions.

#### Acceptance Criteria

1. WHEN the Course_Catalog_Extraction_API returns a non-null Course_Outline value, THE Course_Catalog_Extraction_API SHALL include Source_Evidence containing at least one source page reference when page location is available.
2. WHEN Bedrock_Data_Automation supplies source text or a source region for a value, THE Course_Catalog_Extraction_API SHALL preserve the supplied evidence in the value-level provenance structure.
3. WHEN a Course_Record is consolidated from multiple source listings, THE Course_Catalog_Extraction_API SHALL retain Source_Evidence for each contributing listing.
4. WHEN source evidence is unavailable for a returned value, THE Course_Catalog_Extraction_API SHALL mark the provenance state as unavailable and include a warning rather than fabricating a page reference.

### Requirement 7: Define stable API and result contracts

**User Story:** As an API consumer, I want versioned, machine-readable contracts, so that downstream articulation workflows can safely evolve with extraction capabilities.

#### Acceptance Criteria

1. THE Course_Catalog_Extraction_API SHALL expose a documented API version and include the result-schema version in every Extraction_Result.
2. THE Course_Catalog_Extraction_API SHALL return Structured_Error fields named `code`, `message`, `correlation_id`, and `details` for every documented client or processing error.
3. THE Course_Catalog_Extraction_API SHALL use deterministic JSON field types for every Canonical_Field across all Extraction_Result responses.
4. WHEN the API adds a new optional Canonical_Field, THE Course_Catalog_Extraction_API SHALL preserve compatibility for clients that ignore unknown optional fields.
5. WHEN an Extraction_Result is serialized and later deserialized by a conforming client, THE Course_Catalog_Extraction_API SHALL preserve Course_Record values, missing-field markers, warnings, and provenance semantics.
6. WHEN the API changes a required field type or removes a Canonical_Field, THE Course_Catalog_Extraction_API SHALL publish a new API version before serving the changed contract.

### Requirement 8: Enforce security and privacy controls

**User Story:** As a school data steward, I want catalog documents and processing metadata protected, so that the standalone API can operate under institutional security expectations.

#### Acceptance Criteria

1. THE Course_Catalog_Extraction_API SHALL require encrypted transport for every API request and response.
2. THE Course_Catalog_Extraction_API SHALL store every S3_Object in a private S3 location with server-side encryption enabled.
3. THE Course_Catalog_Extraction_API SHALL grant Bedrock_Data_Automation access only to the S3_Object required by the associated Extraction_Job.
4. THE Course_Catalog_Extraction_API SHALL exclude Catalog_PDF content, credentials, authorization material, and S3_Object keys from ordinary application logs.
5. WHEN an Authenticated_Caller requests a job or result, THE Course_Catalog_Extraction_API SHALL authorize access using the caller identity associated with the Extraction_Job.
6. WHEN the Retention_Period expires, THE Course_Catalog_Extraction_API SHALL delete or render inaccessible the associated S3_Object, Extraction_Result, and Extraction_Job metadata according to the configured retention policy.
7. WHEN a caller exceeds the configured request or upload rate limit, THE Course_Catalog_Extraction_API SHALL return HTTP status `429` with a retry indicator and a Structured_Error.

### Requirement 9: Provide operational resilience and observability

**User Story:** As a platform operator, I want measurable and recoverable processing, so that catalog extraction can be operated without manual inspection of every job.

#### Acceptance Criteria

1. THE Course_Catalog_Extraction_API SHALL emit structured operational events for job accepted, upload stored, extraction started, extraction completed, extraction failed, and retention completed.
2. THE Course_Catalog_Extraction_API SHALL associate every operational event and API response with a correlation identifier that is unique for the request context.
3. WHEN a transient S3 or Bedrock_Data_Automation dependency failure occurs, THE Course_Catalog_Extraction_API SHALL retry according to a bounded configurable retry policy before marking the Extraction_Job as `failed`.
4. WHEN a retry policy is exhausted, THE Course_Catalog_Extraction_API SHALL record the terminal dependency category, preserve the correlation identifier, and avoid unbounded retries.
5. THE Course_Catalog_Extraction_API SHALL expose metrics for accepted jobs, validation failures, active jobs, successful jobs, failed jobs, processing duration, and dependency retries.
6. WHEN the service is restarted during an active Extraction_Job, THE Course_Catalog_Extraction_API SHALL recover the job state from durable metadata and SHALL not create a duplicate Extraction_Job for the same Idempotency_Key.
7. WHEN an operational dependency is unavailable, THE Course_Catalog_Extraction_API SHALL return a bounded-time Structured_Error or retain the job in a documented active state rather than keeping an API request open indefinitely.

### Requirement 10: Establish validation and deployment boundaries

**User Story:** As a development team, I want a standalone and verifiable specification boundary, so that the new API can be implemented without assumptions about existing projects.

#### Acceptance Criteria

1. THE Course_Catalog_Extraction_API SHALL define all request, response, status, error, Canonical_Field, and configuration contracts within the standalone feature implementation.
2. THE Course_Catalog_Extraction_API SHALL not require source files, runtime modules, databases, credentials, or deployment resources from any existing workspace project.
3. WHERE a test environment is configured, THE Course_Catalog_Extraction_API SHALL support dependency-isolated tests that replace S3 and Bedrock_Data_Automation with deterministic test doubles.
4. WHEN a deployment lacks a required S3, Bedrock_Data_Automation, authentication, encryption, or retention configuration, THE Course_Catalog_Extraction_API SHALL fail readiness validation with a named configuration error before accepting Catalog_PDF uploads.
5. THE Course_Catalog_Extraction_API SHALL document Configurable_Limits for upload size, page or processing scope, processing timeout, retry count, request rate, and Retention_Period.

## Correctness Properties for Property-Based Testing

The following properties are test obligations for pure API-contract, validation, normalization, and orchestration logic. Property-based tests SHOULD use generated documents, fields, layouts, and dependency responses with S3 and Bedrock_Data_Automation replaced by deterministic test doubles. External AWS behavior, deployment wiring, and encryption configuration SHOULD use focused integration or smoke tests instead of property-based tests.

### Property P1: Valid upload contract

For every generated byte sequence that has a valid PDF signature, is structurally readable by the configured PDF validator, and is within the Configurable_Limit, submission validation accepts the payload and produces exactly one accepted Extraction_Job when dependencies succeed.

**Covers:** Requirements 1.1, 2.1-2.4.

### Property P2: Invalid upload classification

For every generated payload, validation returns exactly one applicable terminal classification: unsupported media for a missing or invalid PDF signature, payload-too-large for a size violation, invalid-document for an unreadable PDF, or valid for an acceptable PDF. Validation never invokes Bedrock_Data_Automation for a non-valid classification.

**Covers:** Requirements 2.1-2.3 and 2.6.

### Property P3: Idempotent submission

For every valid submission and Idempotency_Key, repeating the same submission any number of times returns the same Extraction_Job identifier and does not increase the number of accepted jobs or stored source objects.

**Covers:** Requirements 1.5 and 9.6.

### Property P4: Idempotency conflict isolation

For every Idempotency_Key associated with one accepted submission, a submission with materially different content or required request metadata returns a conflict and leaves the original job and source object unchanged.

**Covers:** Requirement 1.6.

### Property P5: Missing-field preservation

For every generated Course_Record containing any subset of Canonical_Field values, normalization preserves every supplied value, represents every omitted scalar as `null` and every omitted collection as empty according to the schema, and lists every omitted field in `missing_fields`.

**Covers:** Requirements 4.5 and 5.1-5.6.

### Property P6: Layout-invariant extraction mapping

For every generated set of course listings and every supported permutation of page order, whitespace, line wrapping, heading placement, and section layout, normalization produces equivalent Course_Record identities and equivalent source-supported values, subject to documented consolidation rules.

**Covers:** Requirements 4.1, 4.7, and 4.8.

### Property P7: No unsupported assertions

For every generated provider response containing absent, low-confidence, or unmappable values, normalization never creates a value absent from provider data or Source_Evidence; normalization records the value as missing, uncertain, additional, or unmapped according to the applicable rule.

**Covers:** Requirements 4.6 and 5.2-5.7.

### Property P8: Provenance preservation

For every generated extracted value with one or more source page references, source text snippets, or source regions, serialization and deserialization preserve all supplied evidence and associate evidence with the original Course_Record field.

**Covers:** Requirements 6.1-6.3 and 7.5.

### Property P9: Result round trip

For every valid Extraction_Result generated from the documented schema, encoding the result as the API JSON representation and decoding the representation produces an equivalent result, including optional fields, empty collections, warnings, missing-field markers, confidence scores, and provenance states.

**Covers:** Requirements 7.3 and 7.5.

### Property P10: State-machine lifecycle safety

For every generated sequence of accepted events, dependency responses, bounded retries, restarts, and status requests, an Extraction_Job follows only documented transitions, reaches at most one terminal state, invokes Bedrock_Data_Automation only after source storage, and never creates duplicate jobs for one Idempotency_Key.

**Covers:** Requirements 2.4, 2.6, 3.1-3.5, and 9.3-9.7.

### Property P11: Error-envelope consistency

For every generated documented client, validation, authorization, rate-limit, timeout, and dependency failure, the API response contains `code`, `message`, `correlation_id`, and `details`, uses the mapped HTTP status, and excludes Sensitive_Data and private S3 identifiers.

**Covers:** Requirements 1.3-1.4, 3.4, 3.6-3.8, 7.2, 8.4, and 8.7.

### Property P12: Additional-field conservation

For every generated source field that cannot be represented by a Canonical_Field without semantic loss, normalization retains the source label, normalized value, and available Source_Evidence in `additional_fields` or `unmapped_fields`.

**Covers:** Requirements 4.6 and 5.7.

## Test Strategy Boundaries

- **Property-based tests:** validation classification, idempotency, schema normalization, field omission, layout transformations, provenance conservation, JSON round trips, error-envelope shaping, and lifecycle state-machine logic using mocks.
- **Example-based integration tests:** one representative S3 upload, one Bedrock_Data_Automation success, one provider failure, one timeout, one authorization denial, and one retention execution.
- **Configuration and security smoke tests:** encrypted transport enforcement, private S3 configuration, least-privilege access, required readiness configuration, rate limiting, and retention policy wiring.
- **Out of scope for this requirements document:** implementation language, framework, infrastructure-as-code tool, exact Bedrock_Data_Automation project identifier, authentication vendor, and downstream articulation matching algorithms.
