"""
Lambda handler for API Gateway routes.

Routes:
  POST /upload                        — receive PDF, upload to S3, create DB record, invoke BDA
  POST /query                         — run raw SQL (dev/debug)
  GET  /status/{transcript_id}        — return processing status for a job
  GET  /transcripts                   — paginated list of all transcript jobs
  GET  /transcript/{transcript_id}    — full extracted data for one transcript

  Review & Edit:
  POST /review/lock/{transcript_id}   — lock a transcript for review
  POST /review/unlock/{transcript_id} — release the lock
  POST /review/verify/{transcript_id} — mark as verified
  POST /review/flag/{transcript_id}   — flag for BDA re-run
  PUT  /student/{student_id}          — update student fields
  PUT  /course/{course_id}            — update course fields
  DELETE /course/{course_id}          — delete a course
  POST /student/{student_id}/courses  — add a new course
  GET  /audit/{transcript_id}         — view audit history

API Gateway HTTP API sends events in payload format 2.0.
"""

import base64
import json
import logging
import uuid
from datetime import datetime, timezone, timedelta

from config import Config
from database import (
    ProcessingStatus, ReviewStatus, Transcript, Student, Course, AuditLog, GradingLegend,
    get_session, init_db,
)
from bda_service import upload_to_s3, get_or_create_project, invoke_bda

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialise DB once per cold start (idempotent on warm reuse)
init_db(Config.db_url())


# ---------------------------------------------------------------------------
# Lambda entry point
# ---------------------------------------------------------------------------

def handler(event, context):
    """Route API Gateway requests to the correct function."""
    method      = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    raw_path    = event.get("rawPath", "/")
    path_params = event.get("pathParameters") or {}
    query       = event.get("queryStringParameters") or {}

    logger.info("REQUEST  %s %s", method, raw_path)

    try:
        # Handle CORS preflight
        if method == "OPTIONS":
            return _resp(200, {})

        # POST /upload
        if method == "POST" and raw_path == "/upload":
            return _handle_upload(event)

        # POST /query — run raw SQL (for dev/debug only)
        if method == "POST" and raw_path == "/query":
            return _handle_query(event)

        # --- Review routes ---
        if method == "POST" and raw_path.startswith("/review/lock/"):
            tid = int(raw_path.split("/")[-1])
            return _handle_review_lock(tid, event)

        if method == "POST" and raw_path.startswith("/review/unlock/"):
            tid = int(raw_path.split("/")[-1])
            return _handle_review_unlock(tid, event)

        if method == "POST" and raw_path.startswith("/review/verify/"):
            tid = int(raw_path.split("/")[-1])
            return _handle_review_verify(tid, event)

        if method == "POST" and raw_path.startswith("/review/flag/"):
            tid = int(raw_path.split("/")[-1])
            return _handle_review_flag(tid, event)

        # --- Edit routes ---
        if method == "PUT" and raw_path.startswith("/student/"):
            sid = int(raw_path.split("/")[-1])
            return _handle_update_student(sid, event)

        if method == "PUT" and raw_path.startswith("/course/"):
            cid = int(raw_path.split("/")[-1])
            return _handle_update_course(cid, event)

        if method == "DELETE" and raw_path.startswith("/course/"):
            cid = int(raw_path.split("/")[-1])
            return _handle_delete_course(cid, event)

        if method == "POST" and raw_path.startswith("/student/") and raw_path.endswith("/courses"):
            sid = int(raw_path.split("/")[-2])
            return _handle_add_course(sid, event)

        # --- Audit log ---
        if method == "GET" and raw_path.startswith("/audit/"):
            tid = int(raw_path.split("/")[-1])
            return _handle_audit(tid)

        # --- Delete transcript ---
        if method == "DELETE" and raw_path.startswith("/transcript/"):
            tid = int(raw_path.split("/")[-1])
            return _handle_delete_transcript(tid, event)

        # --- Catalogue routes ---
        if method == "POST" and raw_path == "/catalogue/institution":
            return _handle_create_institution(event)

        if method == "POST" and raw_path.startswith("/catalogue/scrape/"):
            tid = int(raw_path.split("/")[-1])
            return _handle_catalogue_scrape(tid, event)

        if method == "POST" and raw_path == "/catalogue/scrape-course":
            return _handle_catalogue_scrape_single(event)

        if method == "GET" and raw_path.startswith("/catalogue/courses/"):
            inst_id = int(raw_path.split("/")[-1])
            return _handle_catalogue_list(inst_id)

        # GET /status/{transcript_id}
        if method == "GET" and raw_path.startswith("/status/"):
            tid = int(raw_path.split("/")[-1])
            return _handle_status(tid)

        # GET /transcripts
        if method == "GET" and raw_path == "/transcripts":
            page     = int(query.get("page", 1))
            per_page = int(query.get("per_page", 20))
            return _handle_list(page, per_page)

        # GET /transcript/{transcript_id}
        if method == "GET" and raw_path.startswith("/transcript/"):
            tid = int(raw_path.split("/")[-1])
            return _handle_detail(tid)

        return _resp(404, {"error": "Route not found."})

    except Exception as exc:
        logger.exception("Unhandled error: %s", exc)
        return _resp(500, {"error": "Internal server error."})


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------

def _handle_upload(event):
    """
    Decode the PDF from the request body, upload to S3,
    create a Transcript DB record, and invoke a BDA job.
    """
    # API Gateway can base64-encode binary bodies
    body        = event.get("body", "")
    is_b64      = event.get("isBase64Encoded", False)
    headers     = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    content_type = headers.get("content-type", "")

    if "multipart/form-data" not in content_type:
        return _resp(400, {"error": "Content-Type must be multipart/form-data."})

    # Decode body bytes
    if is_b64:
        body_bytes = base64.b64decode(body)
    else:
        body_bytes = body.encode("utf-8") if isinstance(body, str) else body

    # Parse multipart to extract the file
    filename, file_bytes = _parse_multipart(body_bytes, content_type)
    if not filename or not file_bytes:
        return _resp(400, {"error": "Could not parse PDF from request. Ensure field name is 'pdf_file'."})

    if not filename.lower().endswith(".pdf"):
        return _resp(400, {"error": "Only PDF files are accepted."})

    # Upload to S3
    try:
        import io
        s3_key = upload_to_s3(io.BytesIO(file_bytes), filename)
    except Exception as exc:
        logger.exception("S3 upload failed: %s", exc)
        return _resp(500, {"error": f"S3 upload failed: {exc}"})

    # Create DB record
    session = get_session()
    try:
        job_id          = uuid.uuid4().hex
        output_prefix   = f"{Config.S3_OUTPUT_PREFIX.strip('/')}/{job_id}/"

        transcript = Transcript(
            original_filename=filename,
            s3_input_key=s3_key,
            s3_output_prefix=output_prefix,
            status=ProcessingStatus.PENDING,
            uploaded_at=datetime.now(timezone.utc),
        )
        session.add(transcript)
        session.commit()
        transcript_id = transcript.id
    except Exception as exc:
        session.rollback()
        logger.exception("DB insert failed: %s", exc)
        return _resp(500, {"error": f"Database error: {exc}"})
    finally:
        session.close()

    # Invoke BDA job
    try:
        project_arn    = get_or_create_project()
        invocation_arn = invoke_bda(s3_key, output_prefix, project_arn)

        # Update record with BDA ARN and submitted status
        session = get_session()
        try:
            t = session.get(Transcript, transcript_id)
            t.bda_invocation_arn = invocation_arn
            t.status             = ProcessingStatus.SUBMITTED
            session.commit()
        finally:
            session.close()

    except Exception as exc:
        logger.exception("BDA invocation failed: %s", exc)
        # Record the failure but still return the transcript_id so caller can check status
        session = get_session()
        try:
            t               = session.get(Transcript, transcript_id)
            t.status        = ProcessingStatus.FAILED
            t.error_message = str(exc)
            session.commit()
        finally:
            session.close()
        return _resp(500, {"error": f"BDA invocation failed: {exc}"})

    return _resp(202, {
        "message":       "File uploaded successfully. Processing has started.",
        "transcript_id": transcript_id,
        "filename":      filename,
        "status":        ProcessingStatus.SUBMITTED.value,
        "status_url":    f"/status/{transcript_id}",
    })


def _handle_status(transcript_id: int):
    session = get_session()
    try:
        t: Transcript = session.get(Transcript, transcript_id)
        if t is None:
            return _resp(404, {"error": "Transcript not found."})

        payload = {
            "transcript_id": t.id,
            "filename":      t.original_filename,
            "status":        t.status.value,
            "uploaded_at":   _fmt(t.uploaded_at),
            "processed_at":  _fmt(t.processed_at),
            "error_message": t.error_message,
        }
        if t.status == ProcessingStatus.COMPLETED:
            payload["detail_url"] = f"/transcript/{transcript_id}"

        return _resp(200, payload)
    finally:
        session.close()


def _handle_list(page: int, per_page: int):
    page     = max(1, page)
    per_page = min(100, per_page)

    session = get_session()
    try:
        total = session.query(Transcript).count()
        rows  = (
            session.query(Transcript)
            .order_by(Transcript.uploaded_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )
        return _resp(200, {
            "page":        page,
            "per_page":    per_page,
            "total":       total,
            "transcripts": [_summary(t) for t in rows],
        })
    finally:
        session.close()


def _handle_detail(transcript_id: int):
    session = get_session()
    try:
        t: Transcript = session.get(Transcript, transcript_id)
        if t is None:
            return _resp(404, {"error": "Transcript not found."})

        payload = _summary(t)

        if t.student:
            s = t.student
            payload["student"] = {
                "id":              s.id,
                "full_name":       s.full_name,
                "student_id":      s.student_id,
                "date_of_birth":   s.date_of_birth,
                "email":           s.email,
                "phone":           s.phone,
                "address":         s.address,
                "institution":     s.institution,
                "institution_address": s.institution_address,
                "institution_website": s.institution_website,
                "institution_phone":   s.institution_phone,
                "program":         s.program,
                "major":           s.major,
                "minor":           s.minor,
                "enrollment_date": s.enrollment_date,
                "graduation_date": s.graduation_date,
                "gpa":             s.gpa,
                "total_credits":   s.total_credits,
                "raw_text":        s.raw_text,
                "courses": [
                    {
                        "id":           c.id,
                        "course_code":  c.course_code,
                        "course_name":  c.course_name,
                        "credits":      c.credits,
                        "grade":        c.grade,
                        "grade_points": c.grade_points,
                        "term":         c.term,
                        "term_season":  c.term_season,
                        "term_year":    c.term_year,
                        "year":         c.year,
                        "instructor":   c.instructor,
                        "department":   c.department,
                        "status":       c.status,
                    }
                    for c in s.courses
                ],
            }

        # Add grading legend
        legend_rows = (
            session.query(GradingLegend)
            .filter(GradingLegend.transcript_id == transcript_id)
            .all()
        )
        if legend_rows:
            payload["grading_legend"] = [
                {
                    "symbol":       g.symbol,
                    "meaning":      g.meaning,
                    "grade_points": g.grade_points,
                }
                for g in legend_rows
            ]

        return _resp(200, payload)
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Multipart parser
# ---------------------------------------------------------------------------

def _parse_multipart(body_bytes: bytes, content_type: str):
    """
    Minimal multipart/form-data parser.
    Extracts the first file part named 'pdf_file'.
    Returns (filename, file_bytes) or (None, None) on failure.
    """
    # Extract boundary from Content-Type header
    boundary = None
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part[len("boundary="):].strip().strip('"')
            break

    if not boundary:
        return None, None

    delimiter = f"--{boundary}".encode()
    parts     = body_bytes.split(delimiter)

    for part in parts:
        if b"pdf_file" not in part:
            continue
        # Split headers from body on double CRLF
        if b"\r\n\r\n" not in part:
            continue
        headers_raw, _, file_data = part.partition(b"\r\n\r\n")
        # Strip trailing CRLF added by multipart boundary
        file_data = file_data.rstrip(b"\r\n")

        # Extract filename from Content-Disposition header
        filename = "upload.pdf"
        for line in headers_raw.decode("utf-8", errors="ignore").splitlines():
            if "filename=" in line:
                fn_part  = line.split("filename=")[-1].strip().strip('"')
                filename = fn_part or filename
                break

        return filename, file_data

    return None, None


# ---------------------------------------------------------------------------
# Review handlers
# ---------------------------------------------------------------------------

LOCK_TIMEOUT_MINUTES = 30


def _get_body_json(event) -> dict:
    """Parse JSON body from event, handling base64 encoding."""
    body = event.get("body", "")
    is_b64 = event.get("isBase64Encoded", False)
    if is_b64:
        body = base64.b64decode(body).decode("utf-8")
    try:
        return json.loads(body) if body else {}
    except json.JSONDecodeError:
        return {}


def _handle_review_lock(transcript_id: int, event):
    """Lock a transcript for review. Prevents others from editing."""
    payload = _get_body_json(event)
    user_name = payload.get("user_name", "").strip()
    if not user_name:
        return _resp(400, {"error": "Missing 'user_name' in body."})

    session = get_session()
    try:
        t = session.get(Transcript, transcript_id)
        if t is None:
            return _resp(404, {"error": "Transcript not found."})

        now = datetime.now(timezone.utc)

        # Check if already locked by someone else
        if t.review_status == ReviewStatus.IN_REVIEW and t.reviewed_by != user_name:
            # Check if lock has expired
            if t.review_locked_at:
                locked_at = t.review_locked_at.replace(tzinfo=timezone.utc) if t.review_locked_at.tzinfo is None else t.review_locked_at
                if (now - locked_at) < timedelta(minutes=LOCK_TIMEOUT_MINUTES):
                    return _resp(409, {
                        "error": f"Currently being reviewed by '{t.reviewed_by}'.",
                        "locked_by": t.reviewed_by,
                        "locked_at": _fmt(t.review_locked_at),
                        "expires_at": _fmt(locked_at + timedelta(minutes=LOCK_TIMEOUT_MINUTES)),
                    })
            # Lock expired — allow override

        t.review_status    = ReviewStatus.IN_REVIEW
        t.reviewed_by      = user_name
        t.reviewed_at      = now
        t.review_locked_at = now

        # Audit log
        session.add(AuditLog(
            transcript_id=transcript_id,
            table_name="transcripts",
            record_id=transcript_id,
            action="review_started",
            user_name=user_name,
        ))
        session.commit()

        return _resp(200, {
            "message": f"Transcript #{transcript_id} locked for review by '{user_name}'.",
            "expires_at": _fmt(now + timedelta(minutes=LOCK_TIMEOUT_MINUTES)),
        })
    finally:
        session.close()


def _handle_review_unlock(transcript_id: int, event):
    """Release review lock without verifying."""
    payload = _get_body_json(event)
    user_name = payload.get("user_name", "").strip()
    if not user_name:
        return _resp(400, {"error": "Missing 'user_name' in body."})

    session = get_session()
    try:
        t = session.get(Transcript, transcript_id)
        if t is None:
            return _resp(404, {"error": "Transcript not found."})

        if t.review_status != ReviewStatus.IN_REVIEW:
            return _resp(400, {"error": "Transcript is not currently locked."})

        if t.reviewed_by != user_name:
            return _resp(403, {"error": f"Locked by '{t.reviewed_by}', only they can unlock."})

        t.review_status    = ReviewStatus.UNREVIEWED
        t.review_locked_at = None

        session.add(AuditLog(
            transcript_id=transcript_id,
            table_name="transcripts",
            record_id=transcript_id,
            action="review_unlocked",
            user_name=user_name,
        ))
        session.commit()

        return _resp(200, {"message": f"Transcript #{transcript_id} unlocked."})
    finally:
        session.close()


def _handle_review_verify(transcript_id: int, event):
    """Mark transcript as verified (data confirmed correct)."""
    payload = _get_body_json(event)
    user_name = payload.get("user_name", "").strip()
    if not user_name:
        return _resp(400, {"error": "Missing 'user_name' in body."})

    session = get_session()
    try:
        t = session.get(Transcript, transcript_id)
        if t is None:
            return _resp(404, {"error": "Transcript not found."})

        # Must be locked by this user to verify
        if t.review_status == ReviewStatus.IN_REVIEW and t.reviewed_by != user_name:
            return _resp(403, {"error": f"Locked by '{t.reviewed_by}', cannot verify."})

        now = datetime.now(timezone.utc)
        t.review_status    = ReviewStatus.VERIFIED
        t.reviewed_by      = user_name
        t.reviewed_at      = now
        t.review_locked_at = None

        session.add(AuditLog(
            transcript_id=transcript_id,
            table_name="transcripts",
            record_id=transcript_id,
            action="verified",
            user_name=user_name,
        ))
        session.commit()

        return _resp(200, {"message": f"Transcript #{transcript_id} verified by '{user_name}'."})
    finally:
        session.close()


def _handle_review_flag(transcript_id: int, event):
    """Flag transcript for BDA re-run."""
    payload = _get_body_json(event)
    user_name = payload.get("user_name", "").strip()
    if not user_name:
        return _resp(400, {"error": "Missing 'user_name' in body."})

    session = get_session()
    try:
        t = session.get(Transcript, transcript_id)
        if t is None:
            return _resp(404, {"error": "Transcript not found."})

        now = datetime.now(timezone.utc)
        t.review_status    = ReviewStatus.FLAGGED_RERUN
        t.reviewed_by      = user_name
        t.reviewed_at      = now
        t.review_locked_at = None

        session.add(AuditLog(
            transcript_id=transcript_id,
            table_name="transcripts",
            record_id=transcript_id,
            action="flagged_rerun",
            user_name=user_name,
        ))
        session.commit()

        return _resp(200, {"message": f"Transcript #{transcript_id} flagged for re-run by '{user_name}'."})
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Edit handlers
# ---------------------------------------------------------------------------

def _check_edit_permission(transcript_id: int, user_name: str, session) -> str | None:
    """
    Check if the user has permission to edit this transcript.
    Returns an error message if not allowed, None if OK.
    """
    t = session.get(Transcript, transcript_id)
    if t is None:
        return "Transcript not found."

    if t.review_status == ReviewStatus.IN_REVIEW:
        now = datetime.now(timezone.utc)
        # Lock expired?
        if t.review_locked_at:
            locked_at = t.review_locked_at.replace(tzinfo=timezone.utc) if t.review_locked_at.tzinfo is None else t.review_locked_at
            if (now - locked_at) >= timedelta(minutes=LOCK_TIMEOUT_MINUTES):
                return None  # lock expired, allow edit
        if t.reviewed_by != user_name:
            return f"Transcript is locked by '{t.reviewed_by}'. Cannot edit."

    return None


def _handle_update_student(student_id: int, event):
    """Update student fields. Body: {"user_name": "...", "fields": {"full_name": "new value", ...}}"""
    payload = _get_body_json(event)
    user_name = payload.get("user_name", "").strip()
    fields = payload.get("fields", {})

    if not user_name:
        return _resp(400, {"error": "Missing 'user_name' in body."})
    if not fields:
        return _resp(400, {"error": "Missing 'fields' in body."})

    # Allowed fields for student edits
    allowed = {
        "full_name", "student_id", "date_of_birth", "email", "phone", "address",
        "institution", "institution_address", "institution_website", "institution_phone",
        "program", "major", "minor", "enrollment_date",
        "graduation_date", "gpa", "total_credits",
    }
    invalid = set(fields.keys()) - allowed
    if invalid:
        return _resp(400, {"error": f"Invalid fields: {list(invalid)}"})

    session = get_session()
    try:
        student = session.get(Student, student_id)
        if student is None:
            return _resp(404, {"error": "Student not found."})

        # Check edit permission
        err = _check_edit_permission(student.transcript_id, user_name, session)
        if err:
            return _resp(403, {"error": err})

        # Apply changes and log each
        for field, new_value in fields.items():
            old_value = getattr(student, field)
            if str(old_value) == str(new_value):
                continue  # no change

            setattr(student, field, new_value)
            session.add(AuditLog(
                transcript_id=student.transcript_id,
                table_name="students",
                record_id=student_id,
                field_name=field,
                old_value=str(old_value) if old_value is not None else None,
                new_value=str(new_value) if new_value is not None else None,
                action="edit",
                user_name=user_name,
            ))

        session.commit()
        return _resp(200, {"message": f"Student #{student_id} updated."})
    finally:
        session.close()


def _handle_update_course(course_id: int, event):
    """Update course fields. Body: {"user_name": "...", "fields": {"grade": "A", ...}}"""
    payload = _get_body_json(event)
    user_name = payload.get("user_name", "").strip()
    fields = payload.get("fields", {})

    if not user_name:
        return _resp(400, {"error": "Missing 'user_name' in body."})
    if not fields:
        return _resp(400, {"error": "Missing 'fields' in body."})

    allowed = {
        "course_code", "course_name", "credits", "grade", "grade_points",
        "term", "term_season", "term_year", "year", "instructor", "department", "status",
    }
    invalid = set(fields.keys()) - allowed
    if invalid:
        return _resp(400, {"error": f"Invalid fields: {list(invalid)}"})

    session = get_session()
    try:
        course = session.get(Course, course_id)
        if course is None:
            return _resp(404, {"error": "Course not found."})

        # Get transcript_id through student
        student = session.get(Student, course.student_id)
        err = _check_edit_permission(student.transcript_id, user_name, session)
        if err:
            return _resp(403, {"error": err})

        for field, new_value in fields.items():
            old_value = getattr(course, field)
            if str(old_value) == str(new_value):
                continue

            setattr(course, field, new_value)
            session.add(AuditLog(
                transcript_id=student.transcript_id,
                table_name="courses",
                record_id=course_id,
                field_name=field,
                old_value=str(old_value) if old_value is not None else None,
                new_value=str(new_value) if new_value is not None else None,
                action="edit",
                user_name=user_name,
            ))

        session.commit()
        return _resp(200, {"message": f"Course #{course_id} updated."})
    finally:
        session.close()


def _handle_delete_course(course_id: int, event):
    """Delete a course. Body: {"user_name": "..."}"""
    payload = _get_body_json(event)
    user_name = payload.get("user_name", "").strip()

    if not user_name:
        return _resp(400, {"error": "Missing 'user_name' in body."})

    session = get_session()
    try:
        course = session.get(Course, course_id)
        if course is None:
            return _resp(404, {"error": "Course not found."})

        student = session.get(Student, course.student_id)
        err = _check_edit_permission(student.transcript_id, user_name, session)
        if err:
            return _resp(403, {"error": err})

        # Log before deleting
        session.add(AuditLog(
            transcript_id=student.transcript_id,
            table_name="courses",
            record_id=course_id,
            field_name=None,
            old_value=json.dumps({
                "course_code": course.course_code,
                "course_name": course.course_name,
                "credits": course.credits,
                "grade": course.grade,
                "term": course.term,
            }, default=str),
            new_value=None,
            action="course_deleted",
            user_name=user_name,
        ))

        session.delete(course)
        session.commit()
        return _resp(200, {"message": f"Course #{course_id} deleted."})
    finally:
        session.close()


def _handle_add_course(student_id: int, event):
    """Add a new course. Body: {"user_name": "...", "course": {"course_code": "...", ...}}"""
    payload = _get_body_json(event)
    user_name = payload.get("user_name", "").strip()
    course_data = payload.get("course", {})

    if not user_name:
        return _resp(400, {"error": "Missing 'user_name' in body."})
    if not course_data:
        return _resp(400, {"error": "Missing 'course' in body."})

    session = get_session()
    try:
        student = session.get(Student, student_id)
        if student is None:
            return _resp(404, {"error": "Student not found."})

        err = _check_edit_permission(student.transcript_id, user_name, session)
        if err:
            return _resp(403, {"error": err})

        allowed = {
            "course_code", "course_name", "credits", "grade", "grade_points",
            "term", "term_season", "term_year", "year", "instructor", "department", "status",
        }
        filtered = {k: v for k, v in course_data.items() if k in allowed}

        course = Course(student_id=student_id, **filtered)
        session.add(course)
        session.flush()  # get course.id

        session.add(AuditLog(
            transcript_id=student.transcript_id,
            table_name="courses",
            record_id=course.id,
            field_name=None,
            old_value=None,
            new_value=json.dumps(filtered, default=str),
            action="course_added",
            user_name=user_name,
        ))

        session.commit()
        return _resp(201, {"message": f"Course #{course.id} added.", "course_id": course.id})
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Audit log handler
# ---------------------------------------------------------------------------

def _handle_audit(transcript_id: int):
    """Return the full audit history for a transcript."""
    session = get_session()
    try:
        logs = (
            session.query(AuditLog)
            .filter(AuditLog.transcript_id == transcript_id)
            .order_by(AuditLog.created_at.desc())
            .all()
        )
        return _resp(200, {
            "transcript_id": transcript_id,
            "entries": [
                {
                    "id":            log.id,
                    "table_name":    log.table_name,
                    "record_id":     log.record_id,
                    "field_name":    log.field_name,
                    "old_value":     log.old_value,
                    "new_value":     log.new_value,
                    "action":        log.action,
                    "user_name":     log.user_name,
                    "created_at":    _fmt(log.created_at),
                }
                for log in logs
            ],
            "count": len(logs),
        })
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Delete transcript handler
# ---------------------------------------------------------------------------

def _handle_delete_transcript(transcript_id: int, event):
    """
    Delete a transcript and all associated data (student, courses, legend, audit, S3 files).
    Body: {"admin_key": "setup-2026"}
    """
    payload = _get_body_json(event)
    admin_key = payload.get("admin_key", "")
    if admin_key != "setup-2026":
        return _resp(403, {"error": "Admin key required for deletion."})

    import boto3

    session = get_session()
    try:
        t = session.get(Transcript, transcript_id)
        if not t:
            return _resp(404, {"error": "Transcript not found."})

        s3_input_key = t.s3_input_key
        s3_output_prefix = t.s3_output_prefix

        # Delete DB records (cascade handles student/courses via relationship)
        # Delete audit logs
        from database import AuditLog, GradingLegend
        session.query(AuditLog).filter(AuditLog.transcript_id == transcript_id).delete()
        session.query(GradingLegend).filter(GradingLegend.transcript_id == transcript_id).delete()

        # Delete transcript (cascades to student → courses)
        session.delete(t)
        session.commit()

    except Exception as exc:
        session.rollback()
        return _resp(500, {"error": f"DB delete failed: {exc}"})
    finally:
        session.close()

    # Delete S3 files
    try:
        s3 = boto3.client("s3", region_name=Config.AWS_REGION)

        # Delete input PDF
        if s3_input_key:
            s3.delete_object(Bucket=Config.S3_BUCKET_INPUT, Key=s3_input_key)

        # Delete output files (all objects under the prefix)
        if s3_output_prefix:
            prefix = s3_output_prefix.replace("//", "/")
            paginator = s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=Config.S3_BUCKET_OUTPUT, Prefix=prefix):
                for obj in page.get("Contents", []):
                    s3.delete_object(Bucket=Config.S3_BUCKET_OUTPUT, Key=obj["Key"])

    except Exception as exc:
        # S3 deletion is best-effort — DB is already cleaned
        logger.warning("S3 cleanup failed for transcript %d: %s", transcript_id, exc)

    return _resp(200, {"message": f"Transcript #{transcript_id} deleted."})


# ---------------------------------------------------------------------------
# Catalogue handlers
# ---------------------------------------------------------------------------

def _handle_create_institution(event):
    """
    Create or update an institution for catalogue scraping.
    Body: {
        "name": "Utah State University",
        "website": "https://www.usu.edu",
        "catalogue_source_type": "individual_url",
        "catalogue_url_pattern": "https://catalog.usu.edu/courses/{PREFIX}{NUMBER}",
        "credit_system": "semester"
    }
    """
    from catalogue_service import get_or_create_institution

    payload = _get_body_json(event)
    name = payload.get("name", "").strip()
    if not name:
        return _resp(400, {"error": "Missing 'name' in body."})

    inst_id = get_or_create_institution(
        name=name,
        website=payload.get("website"),
        source_type=payload.get("catalogue_source_type", "individual_url"),
        url_pattern=payload.get("catalogue_url_pattern"),
        credit_system=payload.get("credit_system", "semester"),
    )

    return _resp(200, {"message": f"Institution '{name}' ready.", "institution_id": inst_id})


def _handle_catalogue_scrape(transcript_id: int, event):
    """
    Scrape catalogue data for all courses on a transcript.
    Uses the institution's URL pattern to fetch course pages.
    """
    from catalogue_service import lookup_transcript_courses

    results = lookup_transcript_courses(transcript_id)
    return _resp(200, {"transcript_id": transcript_id, "results": results})


def _handle_catalogue_scrape_single(event):
    """
    Scrape a single course from a catalogue.
    Body: {"institution_id": 1, "course_code": "SPAN3117"}
    or:   {"institution_id": 1, "url": "https://catalog.usu.edu/courses/SPAN3117"}
    """
    from catalogue_service import scrape_course_url, scrape_courses_for_institution

    payload = _get_body_json(event)
    institution_id = payload.get("institution_id")
    course_code = payload.get("course_code")
    url = payload.get("url")

    if not institution_id:
        return _resp(400, {"error": "Missing 'institution_id' in body."})

    if url:
        # Direct URL scrape
        result = scrape_course_url(institution_id, url)
        return _resp(200, result)
    elif course_code:
        # Use URL pattern to build URL and scrape
        results = scrape_courses_for_institution(institution_id, [course_code])
        return _resp(200, {"results": results})
    else:
        return _resp(400, {"error": "Provide 'course_code' or 'url' in body."})


def _handle_catalogue_list(institution_id: int):
    """List all scraped catalogue courses for an institution."""
    from database import CatalogueCourse

    session = get_session()
    try:
        courses = (
            session.query(CatalogueCourse)
            .filter(CatalogueCourse.institution_id == institution_id)
            .order_by(CatalogueCourse.course_code)
            .all()
        )
        return _resp(200, {
            "institution_id": institution_id,
            "courses": [
                {
                    "id": c.id,
                    "course_code": c.course_code,
                    "course_prefix": c.course_prefix,
                    "course_number": c.course_number,
                    "title": c.title,
                    "credits": c.credits,
                    "credit_type": c.credit_type,
                    "description": c.description,
                    "prerequisites": c.prerequisites,
                    "department": c.department,
                    "college": c.college,
                    "level": c.level,
                    "grade_mode": c.grade_mode,
                    "source_url": _get_page_url(c.page_id, session),
                }
                for c in courses
            ],
            "count": len(courses),
        })
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Query handler (dev/debug only)
# ---------------------------------------------------------------------------

def _handle_query(event):
    """
    Execute a raw SQL SELECT query and return results as JSON.
    Only SELECT statements are allowed for safety.
    Body: {"sql": "SELECT * FROM courses LIMIT 10"}
    
    One-time admin mode (pass "admin_key" to run DDL):
    Body: {"sql": "CREATE USER ...", "admin_key": "setup-2026"}
    """
    body = event.get("body", "")
    is_b64 = event.get("isBase64Encoded", False)
    if is_b64:
        body = base64.b64decode(body).decode("utf-8")

    try:
        payload = json.loads(body) if body else {}
    except json.JSONDecodeError:
        return _resp(400, {"error": "Invalid JSON body."})

    sql = payload.get("sql", "").strip()
    if not sql:
        return _resp(400, {"error": "Missing 'sql' field in body."})

    admin_key = payload.get("admin_key", "")

    # Safety: only allow SELECT unless admin_key is provided
    if not sql.upper().startswith("SELECT") and admin_key != "setup-2026":
        return _resp(400, {"error": "Only SELECT queries are allowed."})

    from sqlalchemy import text
    session = get_session()
    try:
        result = session.execute(text(sql))
        
        # For SELECT queries, return rows
        if sql.upper().startswith("SELECT"):
            columns = list(result.keys())
            rows = [dict(zip(columns, row)) for row in result.fetchall()]
            return _resp(200, {
                "columns": columns,
                "rows": rows,
                "count": len(rows),
            })
        else:
            session.commit()  # only commit for DDL/DML
            return _resp(200, {"message": "Query executed successfully."})
    except Exception as exc:
        session.rollback()
        return _resp(400, {"error": f"Query failed: {exc}"})
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resp(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "content-type",
        },
        "body":       json.dumps(body, default=str),
    }


def _fmt(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _presign_url(s3_key: str) -> str | None:
    """Generate a presigned URL for viewing the uploaded PDF (valid 1 hour)."""
    if not s3_key:
        return None
    try:
        import boto3
        s3 = boto3.client("s3", region_name=Config.AWS_REGION)
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": Config.S3_BUCKET_INPUT, "Key": s3_key},
            ExpiresIn=3600,
        )
        return url
    except Exception:
        return None


def _get_page_url(page_id, session) -> str | None:
    """Get the source URL for a catalogue page."""
    if not page_id:
        return None
    from database import CataloguePage
    page = session.get(CataloguePage, page_id)
    return page.url if page else None


def _summary(t: Transcript) -> dict:
    return {
        "transcript_id": t.id,
        "filename":      t.original_filename,
        "s3_input_key":  t.s3_input_key,
        "status":        t.status.value,
        "review_status": t.review_status.value if t.review_status else "unreviewed",
        "uploaded_at":   _fmt(t.uploaded_at),
        "processed_at":  _fmt(t.processed_at),
        "error_message": t.error_message,
        "pdf_url":       _presign_url(t.s3_input_key),
        "detail_url":    f"/transcript/{t.id}",
        "status_url":    f"/status/{t.id}",
    }
