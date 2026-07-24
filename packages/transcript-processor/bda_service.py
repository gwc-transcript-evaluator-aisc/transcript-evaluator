"""
Amazon Bedrock Data Automation service layer.

Functions used by lambda_upload.py:
  - upload_to_s3()          — upload a PDF to the S3 input bucket
  - get_or_create_project() — return a BDA project ARN, creating one if needed
  - invoke_bda()            — submit an async BDA job

Functions used by lambda_processor.py:
  - fetch_bda_output()      — download and parse the BDA result JSON from S3
  - parse_bda_output()      — extract student info and course list from BDA result

Note: polling is NOT done here. The result processor Lambda is triggered
automatically by an S3 event when BDA writes its output, so no polling loop
is needed.
"""

import json
import logging
import uuid
from typing import IO

import boto3

from config import Config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# AWS client helpers — no explicit credentials needed on Lambda;
# the IAM role attached to the function provides access automatically.
# ---------------------------------------------------------------------------

def _s3():
    return boto3.client("s3", region_name=Config.AWS_REGION)


def _bda_control():
    """bedrock-data-automation — project management plane."""
    return boto3.client("bedrock-data-automation", region_name=Config.AWS_REGION)


def _bda_runtime():
    """bedrock-data-automation-runtime — job invocation plane."""
    return boto3.client("bedrock-data-automation-runtime", region_name=Config.AWS_REGION)


# ---------------------------------------------------------------------------
# S3 upload
# ---------------------------------------------------------------------------

def upload_to_s3(file_obj: IO[bytes], original_filename: str) -> str:
    """
    Upload *file_obj* to the configured input S3 bucket.
    Returns the S3 key of the uploaded object.
    """
    unique_name = f"{uuid.uuid4().hex}_{original_filename}"
    s3_key      = f"{Config.S3_INPUT_PREFIX.rstrip('/')}/{unique_name}"

    logger.info("Uploading %s → s3://%s/%s", original_filename, Config.S3_BUCKET_INPUT, s3_key)
    _s3().upload_fileobj(
        file_obj,
        Config.S3_BUCKET_INPUT,
        s3_key,
        ExtraArgs={"ContentType": "application/pdf"},
    )
    logger.info("Upload complete: %s", s3_key)
    return s3_key


# ---------------------------------------------------------------------------
# BDA project — get or create
# ---------------------------------------------------------------------------

def get_or_create_project() -> str:
    """
    Return a BDA project ARN.
    Uses BDA_PROJECT_ARN from config if set (fast path).
    Otherwise searches existing projects by name, creating one if not found.
    """
    if Config.BDA_PROJECT_ARN:
        logger.info("Using pre-configured BDA project: %s", Config.BDA_PROJECT_ARN)
        return Config.BDA_PROJECT_ARN

    client = _bda_control()

    # Check for existing project with same name
    paginator = client.get_paginator("list_data_automation_projects")
    for page in paginator.paginate():
        for project in page.get("projects", []):
            if project.get("projectName") == Config.BDA_PROJECT_NAME:
                arn = project["projectArn"]
                logger.info("Found existing BDA project: %s", arn)
                return arn

    # Create a new project optimised for document (PDF) extraction
    logger.info("Creating BDA project: %s", Config.BDA_PROJECT_NAME)
    response = client.create_data_automation_project(
        projectName=Config.BDA_PROJECT_NAME,
        projectDescription="Extracts text, personal info, and course data from student transcripts.",
        projectStage="LIVE",
        standardOutputConfiguration={
            "document": {
                "extraction": {
                    "granularity": {
                        "types": ["DOCUMENT", "PAGE"]
                    },
                    "boundingBox": {"state": "DISABLED"},
                },
                "generativeField": {"state": "ENABLED"},
                "outputFormat": {
                    "textFormat": {"types": ["PLAIN_TEXT", "MARKDOWN"]},
                    "additionalFileFormat": {"state": "DISABLED"},
                },
            }
        },
    )
    arn = response["projectArn"]
    logger.info("Created BDA project: %s", arn)
    return arn


# ---------------------------------------------------------------------------
# Invoke BDA async job
# ---------------------------------------------------------------------------

def invoke_bda(s3_input_key: str, output_prefix: str, project_arn: str) -> str:
    """
    Submit an async BDA job.
    Returns the invocation ARN stored in the DB for reference.
    """
    input_uri  = f"s3://{Config.S3_BUCKET_INPUT}/{s3_input_key}"
    output_uri = f"s3://{Config.S3_BUCKET_OUTPUT}/{output_prefix.strip('/')}/"

    logger.info("Invoking BDA  input=%s  output=%s", input_uri, output_uri)

    kwargs = dict(
        inputConfiguration={"s3Uri": input_uri},
        outputConfiguration={"s3Uri": output_uri},
        dataAutomationConfiguration={
            "dataAutomationProjectArn": project_arn,
            "stage": "LIVE",
        },
        dataAutomationProfileArn=Config.BDA_PROFILE_ARN,
        notificationConfiguration={
            "eventBridgeConfiguration": {"eventBridgeEnabled": False}
        },
    )

    response = _bda_runtime().invoke_data_automation_async(**kwargs)
    invocation_arn = response["invocationArn"]
    logger.info("BDA job submitted: %s", invocation_arn)
    return invocation_arn


# ---------------------------------------------------------------------------
# Fetch and parse BDA output (called by lambda_processor.py)
# ---------------------------------------------------------------------------

def fetch_bda_output(bucket: str, prefix: str) -> dict:
    """
    Download the BDA result JSON from the given S3 bucket/prefix.
    Prefers custom_output (blueprint result) over standard_output.
    If both exist, merges raw text from standard into the custom result.
    Returns the parsed JSON as a dict.
    """
    logger.info("Listing BDA output under s3://%s/%s", bucket, prefix)
    s3_client  = _s3()
    paginator  = s3_client.get_paginator("list_objects_v2")
    custom_key = None
    standard_key = None

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if "job_metadata" in key or not key.endswith(".json"):
                continue
            if "custom_output" in key:
                custom_key = key
            elif "standard_output" in key:
                standard_key = key

    # The transcript pipeline requires the custom blueprint result. Standard
    # output can arrive first and is useful only as supplemental raw text; do
    # not complete a transcript from it alone.
    if not custom_key:
        raise FileNotFoundError(
            f"No custom BDA blueprint result JSON found under s3://{bucket}/{prefix}"
        )
    result_key = custom_key

    logger.info("Downloading BDA result: s3://%s/%s", bucket, result_key)
    obj = s3_client.get_object(Bucket=bucket, Key=result_key)
    data = json.loads(obj["Body"].read().decode("utf-8"))

    # If we have custom output, also fetch standard output for raw text
    if custom_key and standard_key:
        logger.info("Also downloading standard output for raw text: s3://%s/%s", bucket, standard_key)
        std_obj = s3_client.get_object(Bucket=bucket, Key=standard_key)
        std_data = json.loads(std_obj["Body"].read().decode("utf-8"))
        # Attach standard output so _extract_text can find it
        data["_standard_output"] = std_data

    return data


# ---------------------------------------------------------------------------
# Parse BDA output
# ---------------------------------------------------------------------------

def _safe_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_term(raw_term: str) -> tuple[str | None, str | None]:
    """
    Parse a term/semester string into (season, year).

    Handles formats like:
      "FALL 2020"
      "FALL 2020 (09/21/2020 12/11/2020)"
      "VN Full Time 059 Term 1 November 2021"
      "Spring Quarter 2019"
      "2019 (09/23/2019 12/13/2019)"
      "Summer 2020 (07/06/2020 08/24/2020)"
      "Term 2 March 2022"

    Returns (season, year) — either can be None if not parseable.
    """
    import re
    if not raw_term:
        return None, None

    term = raw_term.strip()
    season = None
    year = None

    # Extract year: look for a 4-digit year (2000-2099)
    year_match = re.search(r'\b(20\d{2})\b', term)
    if year_match:
        year = year_match.group(1)

    # Extract season: look for known keywords
    term_upper = term.upper()

    # Standard seasons
    if "FALL" in term_upper:
        season = "FALL"
    elif "SPRING" in term_upper:
        season = "SPRING"
    elif "SUMMER" in term_upper:
        season = "SUMMER"
    elif "WINTER" in term_upper:
        season = "WINTER"
    # Quarter-based systems
    elif "QUARTER 1" in term_upper or "QTR 1" in term_upper or "Q1" in term_upper:
        season = "QUARTER 1"
    elif "QUARTER 2" in term_upper or "QTR 2" in term_upper or "Q2" in term_upper:
        season = "QUARTER 2"
    elif "QUARTER 3" in term_upper or "QTR 3" in term_upper or "Q3" in term_upper:
        season = "QUARTER 3"
    elif "QUARTER 4" in term_upper or "QTR 4" in term_upper or "Q4" in term_upper:
        season = "QUARTER 4"
    # Term-based (vocational/nursing programs)
    elif re.search(r'TERM\s*1', term_upper):
        season = "TERM 1"
    elif re.search(r'TERM\s*2', term_upper):
        season = "TERM 2"
    elif re.search(r'TERM\s*3', term_upper):
        season = "TERM 3"
    elif re.search(r'TERM\s*4', term_upper):
        season = "TERM 4"
    # Month-based fallback (infer season from month name)
    else:
        month_match = re.search(
            r'\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\b',
            term_upper
        )
        if month_match:
            month = month_match.group(1)
            if month in ("SEPTEMBER", "OCTOBER", "NOVEMBER"):
                season = "FALL"
            elif month in ("JANUARY", "FEBRUARY", "MARCH"):
                season = "WINTER"
            elif month in ("APRIL", "MAY"):
                season = "SPRING"
            elif month in ("JUNE", "JULY", "AUGUST"):
                season = "SUMMER"
            elif month == "DECEMBER":
                season = "FALL"
            else:
                season = month  # store raw month as season

    return season, year


def _search_institution_website(institution_name: str, address: str | None = None) -> str | None:
    """
    Attempt to determine the institution's website URL.
    Uses a Bedrock model to infer the URL from the institution name and address.
    Returns the URL string or None if not found.
    """
    try:
        bedrock = boto3.client("bedrock-runtime", region_name=Config.AWS_REGION)

        prompt = f"What is the official website URL for the educational institution named '{institution_name}'"
        if address:
            prompt += f" located at {address}"
        prompt += "? Return ONLY the URL (e.g. www.example.edu), nothing else. If unknown, return NONE."

        response = bedrock.invoke_model(
            modelId=Config.BEDROCK_MODEL_ID,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 100,
                "messages": [{"role": "user", "content": prompt}],
            }),
            contentType="application/json",
        )

        result = json.loads(response["body"].read())
        answer = result["content"][0]["text"].strip()

        # Validate it looks like a URL
        if answer and answer.upper() != "NONE" and ("." in answer):
            # Clean up: remove http(s):// prefix if present, trailing punctuation
            answer = answer.replace("https://", "").replace("http://", "").rstrip("/.")
            return answer

        return None

    except Exception as exc:
        logger.warning("Web search fallback failed for '%s': %s", institution_name, exc)
        return None


def _extract_text(bda_result: dict) -> str:
    """Pull plain text from BDA output (standard or custom)."""
    # Check if standard output was attached separately
    source = bda_result.get("_standard_output", bda_result)

    # Standard output structure
    doc = source.get("document", {})
    rep = doc.get("representation", {})
    text = rep.get("text", "") or rep.get("markdown", "")
    if text:
        return text

    # Per-page fallback
    pages = source.get("pages", [])
    lines = []
    for page in pages:
        page_text = page.get("representation", {}).get("text", "")
        if page_text:
            lines.append(page_text)
    return "\n\n".join(lines)


def parse_bda_output(bda_result: dict) -> tuple[dict, list[dict]]:
    """
    Parse BDA JSON into student info dict and list of course dicts.

    Uses the blueprint's inference_result for structured extraction.
    If no inference_result is found (blueprint not matched), stores raw text
    with empty fields for manual review.

    Returns:
        student_data : dict matching Student model fields
        courses_data : list of dicts matching Course model fields
    """
    raw_text = _extract_text(bda_result)

    # Find inference_result from blueprint output
    inference = {}

    if "inference_result" in bda_result:
        inference = bda_result["inference_result"]
    else:
        segments = bda_result.get("outputSegments", [bda_result])
        for seg in segments:
            custom = seg.get("customOutput", {})
            ir = custom.get("inference_result", {})
            if ir:
                inference = ir
                break

    if not inference:
        # No blueprint result — store raw text for manual review
        logger.warning("No inference_result found in BDA output — storing raw text only.")
        student_data = {
            "full_name": None, "student_id": None, "date_of_birth": None,
            "email": None, "phone": None, "address": None,
            "institution": None, "program": None, "major": None, "minor": None,
            "enrollment_date": None, "graduation_date": None,
            "gpa": None, "total_credits": None,
            "raw_text": raw_text[:10000],
        }
        return student_data, [], []

    # Blueprint output — extract structured fields
    student_data = {
        "full_name":       inference.get("student_name"),
        "student_id":      inference.get("student_id"),
        "date_of_birth":   inference.get("date_of_birth"),
        "email":           inference.get("email"),
        "phone":           inference.get("phone"),
        "address":         inference.get("address"),
        "institution":     inference.get("school_name") or inference.get("institution"),
        "institution_address": inference.get("school_address"),
        "institution_website": inference.get("school_website"),
        "institution_phone":   inference.get("school_phone"),
        "program":         inference.get("diploma_type") or inference.get("program"),
        "major":           inference.get("major"),
        "minor":           inference.get("minor"),
        "enrollment_date": inference.get("enrollment_date"),
        "graduation_date": inference.get("graduation_date"),
        "gpa":             _safe_float(inference.get("overall_gpa") or inference.get("gpa")),
        "total_credits":   _safe_float(inference.get("total_credits_earned") or inference.get("total_credits")),
        "raw_text":        raw_text[:10000],
    }

    # Web search fallback: if no website was extracted, try to find it
    if not student_data["institution_website"] and student_data["institution"]:
        student_data["institution_website"] = _search_institution_website(
            student_data["institution"],
            student_data.get("institution_address"),
        )

    # Extract courses — filter out empty entries
    courses_data = []
    for c in (inference.get("courses") or []):
        # Skip completely empty course entries
        if not any([c.get("course_code"), c.get("course_name"), c.get("grade")]):
            continue

        # Parse term into season and year
        raw_term = c.get("term") or c.get("semester") or ""
        term_season, term_year = _parse_term(raw_term)

        courses_data.append({
            "course_code":  c.get("course_code"),
            "course_name":  c.get("course_name"),
            "credits":      _safe_float(c.get("credits")),
            "grade":        c.get("grade"),
            "grade_points": _safe_float(c.get("grade_points")),
            "term":         raw_term,
            "term_season":  term_season,
            "term_year":    term_year,
            "year":         term_year,
            "instructor":   c.get("instructor"),
            "department":   c.get("department"),
            "status":       c.get("status"),
        })

    # Extract grading legend
    legend_data = []
    for g in (inference.get("grading_legend") or []):
        if not g.get("symbol"):
            continue
        legend_data.append({
            "symbol":       g.get("symbol"),
            "meaning":      g.get("meaning"),
            "grade_points": g.get("grade_points"),
        })

    return student_data, courses_data, legend_data
