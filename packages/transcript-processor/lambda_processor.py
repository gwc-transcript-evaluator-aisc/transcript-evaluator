"""
Lambda handler triggered by S3 PUT events.

When BDA finishes processing a document it writes a result JSON file to the
output S3 bucket. That PUT event triggers this function automatically.

Flow:
  1. Parse the S3 event to get the bucket and key of the result file
  2. Derive the output prefix (the folder BDA wrote to)
  3. Find the matching Transcript row by s3_output_prefix
  4. Download and parse the BDA result JSON
  5. Save Student + Course rows to the database
  6. Mark the Transcript as COMPLETED (or FAILED on error)
"""

import logging
from datetime import datetime, timezone
from urllib.parse import unquote_plus

from config import Config
from database import Course, ProcessingStatus, Student, Transcript, GradingLegend, get_session, init_db
from bda_service import fetch_bda_output, parse_bda_output

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialise DB once per cold start
init_db(Config.db_url())


# ---------------------------------------------------------------------------
# Lambda entry point
# ---------------------------------------------------------------------------

def handler(event, context):
    """
    Process an "object created" notification for a file written by BDA.

    The stack triggers this function through EventBridge (the output bucket has
    EventBridge notifications enabled and a rule targets this Lambda), so the
    primary event shape is an EventBridge "Object Created" event. A native S3
    notification shape ("Records") is also accepted as a fallback so the handler
    works regardless of how the trigger is wired.
    """
    targets = _extract_targets(event)
    logger.info("Received %d object-created target(s)", len(targets))

    for bucket, key in targets:
        logger.info("Processing object: s3://%s/%s", bucket, key)
        # Let failures escape the invocation so EventBridge applies its retry and
        # dead-letter policy. A successful return means every target completed.
        _process_record(bucket, key)

    return {"statusCode": 200}


def _extract_targets(event: dict) -> list[tuple[str, str]]:
    """
    Normalise the incoming event into a list of (bucket, key) tuples,
    supporting both EventBridge "Object Created" events and native S3
    notification events.
    """
    # EventBridge "Object Created" event (how this stack triggers the Lambda)
    if event.get("source") == "aws.s3" and "detail" in event:
        detail = event.get("detail") or {}
        bucket = (detail.get("bucket") or {}).get("name")
        key    = (detail.get("object") or {}).get("key")
        if bucket and key:
            return [(bucket, key)]
        logger.warning("EventBridge event missing bucket/key: %s", event)
        return []

    # Native S3 notification event (fallback). S3 URL-encodes object keys here.
    targets: list[tuple[str, str]] = []
    for record in event.get("Records", []):
        s3 = record.get("s3", {})
        bucket = s3.get("bucket", {}).get("name")
        key    = s3.get("object", {}).get("key")
        if bucket and key:
            targets.append((bucket, unquote_plus(key)))
    return targets


# ---------------------------------------------------------------------------
# Per-record processor
# ---------------------------------------------------------------------------

def _process_record(bucket: str, key: str) -> None:
    """
    Match the S3 key to a Transcript row, parse BDA output,
    and save the extracted data to the database.
    """
    # Skip job_metadata files — only process the actual result JSON
    if "job_metadata" in key or not key.endswith(".json"):
        logger.info("Skipping non-result file: %s", key)
        return

    # BDA writes results deep inside the output prefix, e.g.:
    # bda-output/abc123//invocation-id/0/standard_output/0/result.json
    # We stored only the top-level prefix: "bda-output/abc123/"
    # Match by checking if the key starts with the stored prefix (strip trailing slashes).
    # Also normalise double slashes that BDA sometimes adds.
    normalised_key = key.replace("//", "/")

    # Find the Transcript row whose s3_output_prefix is a prefix of this key
    session = get_session()
    transcript = None
    try:
        # Load recent submitted/pending transcripts and check prefix match
        candidates = (
            session.query(Transcript)
            .filter(Transcript.status.in_(["submitted", "pending"]))
            .all()
        )
        for candidate in candidates:
            stored = candidate.s3_output_prefix.replace("//", "/").rstrip("/")
            if normalised_key.startswith(stored + "/") or normalised_key.startswith(stored):
                transcript = candidate
                break

        if transcript is None:
            logger.warning(
                "No Transcript found matching output key '%s'. "
                "The file may have been written by a different job.",
                normalised_key,
            )
            return

        if transcript.status == ProcessingStatus.COMPLETED:
            logger.info("Transcript %d already completed — skipping.", transcript.id)
            return

        transcript_id = transcript.id
        logger.info("Matched Transcript id=%d filename=%r", transcript_id, transcript.original_filename)

    finally:
        session.close()

    # Fetch and parse the BDA result — use the stored output prefix from the transcript
    try:
        output_prefix          = transcript.s3_output_prefix.replace("//", "/").strip("/") + "/"
        bda_result             = fetch_bda_output(bucket, output_prefix)
        student_data, courses, legend = parse_bda_output(bda_result)
    except Exception as exc:
        # BDA writes related output objects independently. The first event can
        # arrive before the custom result is readable, so keep the transcript
        # eligible for a later event and let EventBridge retry this invocation.
        logger.exception("Failed to fetch/parse BDA output: %s", exc)
        raise

    # Persist Student + Course rows
    session = get_session()
    try:
        # Re-fetch transcript in this session
        t = session.get(Transcript, transcript_id)

        # Guard against duplicate processing (S3 triggers can fire multiple times)
        if t.status == ProcessingStatus.COMPLETED:
            logger.info("Transcript %d already completed (race condition) — skipping.", transcript_id)
            session.close()
            return

        # Check if student already exists for this transcript
        existing = session.query(Student).filter(Student.transcript_id == transcript_id).first()
        if existing:
            logger.info("Student already exists for transcript %d — skipping.", transcript_id)
            t.status = ProcessingStatus.COMPLETED
            t.processed_at = datetime.now(timezone.utc)
            session.commit()
            session.close()
            return

        # Use row-level lock on transcript to prevent concurrent inserts
        from sqlalchemy import text
        session.execute(
            text("SELECT id FROM transcripts WHERE id = :tid FOR UPDATE NOWAIT"),
            {"tid": transcript_id}
        )

        # Double-check after acquiring lock
        existing = session.query(Student).filter(Student.transcript_id == transcript_id).first()
        if existing:
            logger.info("Student already exists for transcript %d (post-lock check) — skipping.", transcript_id)
            t.status = ProcessingStatus.COMPLETED
            t.processed_at = datetime.now(timezone.utc)
            session.commit()
            session.close()
            return

        student = Student(transcript_id=t.id, **student_data)
        session.add(student)
        session.flush()  # populate student.id before adding courses

        for course_dict in courses:
            session.add(Course(student_id=student.id, **course_dict))

        # Save grading legend
        for legend_entry in legend:
            session.add(GradingLegend(transcript_id=transcript_id, **legend_entry))

        t.status       = ProcessingStatus.COMPLETED
        t.processed_at = datetime.now(timezone.utc)
        session.commit()

        logger.info(
            "Transcript %d completed — student=%r, courses=%d",
            transcript_id,
            student.full_name,
            len(courses),
        )

    except Exception as exc:
        session.rollback()
        # Another output event may be persisting the same transcript. Retry
        # after that transaction commits; a later invocation will observe the
        # student row and safely mark the transcript completed.
        exc_str = str(exc)
        if "could not obtain lock" in exc_str or "UniqueViolation" in exc_str:
            logger.info("Transcript %d: concurrent processing detected; retrying. (%s)", transcript_id, exc_str[:100])
            raise

        # Preserve submitted status and surface the failure so EventBridge can
        # retry transient database errors instead of acknowledging data loss.
        logger.exception("DB write failed for transcript %d: %s", transcript_id, exc)
        raise
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _mark_failed(transcript_id: int, error_message: str) -> None:
    """Set a transcript's status to FAILED with an error message."""
    session = get_session()
    try:
        t = session.get(Transcript, transcript_id)
        if t:
            t.status        = ProcessingStatus.FAILED
            t.error_message = error_message
            session.commit()
    except Exception as exc:
        session.rollback()
        logger.exception("Could not mark transcript %d as failed: %s", transcript_id, exc)
    finally:
        session.close()
