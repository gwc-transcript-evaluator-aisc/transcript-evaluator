"""
Course Catalogue Scraping & Parsing Service.

Responsibilities:
  1. fetch_page()           — fetch a URL's content (simple HTTP or browser fallback)
  2. scrape_institution()   — scrape all courses for an institution based on its source type
  3. scrape_course_by_url() — fetch and parse a single course page
  4. parse_usu_course()     — parse USU-style individual course pages
  5. lookup_courses_from_transcript() — given transcript courses, fetch their catalogue entries

Architecture:
  - fetch_page() has two methods: "simple" (urllib) and "browser" (placeholder for future)
  - Institution.catalogue_source_type determines the scraping strategy
  - Raw content always stored; parsing is a separate step that can be re-run
"""

import json
import logging
import re
import urllib.request
import urllib.error
from datetime import datetime, timezone
from html.parser import HTMLParser

from config import Config
from database import (
    Institution, CataloguePage, CatalogueCourse,
    get_session, init_db,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Page fetching
# ---------------------------------------------------------------------------

def fetch_page(url: str, method: str = "simple", timeout: int = 30) -> dict:
    """
    Fetch a web page and return its content.

    Args:
        url: The URL to fetch
        method: "simple" (urllib) or "browser" (headless, future)
        timeout: Request timeout in seconds

    Returns:
        dict with keys: content (str), content_type (str), status (int), error (str|None)
    """
    if method == "simple":
        return _fetch_simple(url, timeout)
    elif method == "browser":
        return _fetch_browser(url, timeout)
    else:
        return {"content": None, "content_type": None, "status": 0, "error": f"Unknown method: {method}"}


def _fetch_simple(url: str, timeout: int) -> dict:
    """Fetch using urllib — fast, works for static HTML pages."""
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; TranscriptBot/1.0)",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            content_type = response.headers.get("Content-Type", "text/html")
            charset = "utf-8"
            if "charset=" in content_type:
                charset = content_type.split("charset=")[-1].strip()
            raw = response.read()
            content = raw.decode(charset, errors="replace")
            return {
                "content": content,
                "content_type": content_type.split(";")[0].strip(),
                "status": response.status,
                "error": None,
            }
    except urllib.error.HTTPError as e:
        return {"content": None, "content_type": None, "status": e.code, "error": str(e)}
    except Exception as e:
        return {"content": None, "content_type": None, "status": 0, "error": str(e)}


def _fetch_browser(url: str, timeout: int) -> dict:
    """
    Placeholder for headless browser fetching.
    Future implementation: use a service like ScrapingBee, Browserless,
    or a Lambda layer with Playwright/Chromium.
    """
    logger.warning("Browser fetch not implemented yet. Falling back to simple fetch.")
    # TODO: Implement headless browser fetch for JavaScript-rendered pages.
    # Options:
    #   1. ScrapingBee API: requests.get(f"https://app.scrapingbee.com/api/v1?api_key={KEY}&url={url}&render_js=true")
    #   2. Browserless API: similar pattern
    #   3. Lambda layer with Playwright (heavy but self-hosted)
    #
    # For now, fall back to simple:
    return _fetch_simple(url, timeout)


# ---------------------------------------------------------------------------
# HTML text extraction
# ---------------------------------------------------------------------------

class _TextExtractor(HTMLParser):
    """Simple HTML-to-text converter that preserves basic structure and skips footer/nav."""

    def __init__(self):
        super().__init__()
        self.text_parts = []
        self._skip = False
        self._skip_depth = 0
        self._skip_tags = {"script", "style", "noscript", "footer", "nav"}
        self._skip_classes = {"footer", "nav", "site-footer", "page-footer", "navbar",
                              "breadcrumb", "sidebar", "menu", "cookie"}

    def handle_starttag(self, tag, attrs):
        if self._skip_depth > 0:
            self._skip_depth += 1
            return

        # Check if this tag or its classes should be skipped
        attr_dict = dict(attrs)
        classes = (attr_dict.get("class", "") + " " + attr_dict.get("id", "")).lower()

        if tag in self._skip_tags or any(c in classes for c in self._skip_classes):
            self._skip = True
            self._skip_depth = 1
            return

        if tag in ("br", "p", "div", "h1", "h2", "h3", "h4", "li", "tr"):
            self.text_parts.append("\n")

    def handle_endtag(self, tag):
        if self._skip_depth > 0:
            self._skip_depth -= 1
            if self._skip_depth == 0:
                self._skip = False
            return

    def handle_data(self, data):
        if not self._skip:
            self.text_parts.append(data)

    def get_text(self) -> str:
        return "".join(self.text_parts).strip()


def html_to_text(html: str) -> str:
    """Convert HTML to plain text."""
    extractor = _TextExtractor()
    extractor.feed(html)
    return extractor.get_text()


# ---------------------------------------------------------------------------
# Institution management
# ---------------------------------------------------------------------------

def get_or_create_institution(
    name: str,
    website: str = None,
    source_type: str = "individual_url",
    url_pattern: str = None,
    credit_system: str = "semester",
) -> int:
    """
    Get or create an institution record.
    Returns the institution ID.
    """
    session = get_session()
    try:
        inst = session.query(Institution).filter(Institution.name == name).first()
        if inst:
            # Update fields if provided
            if website and not inst.website:
                inst.website = website
            if url_pattern and not inst.catalogue_url_pattern:
                inst.catalogue_url_pattern = url_pattern
            if source_type and not inst.catalogue_source_type:
                inst.catalogue_source_type = source_type
            session.commit()
            return inst.id

        inst = Institution(
            name=name,
            website=website,
            catalogue_source_type=source_type,
            catalogue_url_pattern=url_pattern,
            credit_system=credit_system,
        )
        session.add(inst)
        session.commit()
        return inst.id
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Course scraping — individual URL pattern (like USU)
# ---------------------------------------------------------------------------

def scrape_course_url(institution_id: int, url: str, method: str = "simple") -> dict:
    """
    Fetch a single course URL, store the raw page, and parse it.

    Returns:
        dict with: page_id, course_data (dict), error (str|None)
    """
    # Fetch the page
    result = fetch_page(url, method=method)
    if result["error"]:
        logger.error("Failed to fetch %s: %s", url, result["error"])
        return {"page_id": None, "course_data": None, "error": result["error"]}

    content = result["content"]
    content_type = result["content_type"]

    # Store raw page
    session = get_session()
    try:
        page = CataloguePage(
            institution_id=institution_id,
            url=url,
            raw_content=content,
            content_type=content_type,
            status="scraped",
        )
        session.add(page)
        session.commit()
        page_id = page.id
    finally:
        session.close()

    # Extract text from HTML
    text_content = html_to_text(content) if "html" in (content_type or "") else content

    # Parse course data
    course_data = parse_course_page(text_content, url)
    course_data["raw_content"] = text_content

    # Store parsed course
    if course_data.get("course_code") or course_data.get("title"):
        session = get_session()
        try:
            cat_course = CatalogueCourse(
                institution_id=institution_id,
                page_id=page_id,
                course_code=course_data.get("course_code"),
                course_prefix=course_data.get("course_prefix"),
                course_number=course_data.get("course_number"),
                title=course_data.get("title"),
                credits=course_data.get("credits"),
                credit_type=course_data.get("credit_type"),
                description=course_data.get("description"),
                prerequisites=course_data.get("prerequisites"),
                corequisites=course_data.get("corequisites"),
                department=course_data.get("department"),
                college=course_data.get("college"),
                level=course_data.get("level"),
                grade_mode=course_data.get("grade_mode"),
                repeat_status=course_data.get("repeat_status"),
                raw_content=text_content,
            )
            session.add(cat_course)

            # Mark page as parsed
            page_obj = session.get(CataloguePage, page_id)
            if page_obj:
                page_obj.status = "parsed"

            session.commit()
        finally:
            session.close()

    return {"page_id": page_id, "course_data": course_data, "error": None}


def parse_course_page(text: str, url: str = "") -> dict:
    """
    Parse course information from page text using Bedrock (Claude).
    Falls back to basic extraction if Bedrock fails.

    Returns a dict with all available fields.
    """
    import boto3

    # Try to extract course code from URL (USU pattern: /courses/SPAN3117)
    data = {}
    url_match = re.search(r"/courses/([A-Z]+)(\d+)", url)
    if url_match:
        data["course_prefix"] = url_match.group(1)
        data["course_number"] = url_match.group(2)
        data["course_code"] = f"{url_match.group(1)}{url_match.group(2)}"

    # Use Bedrock to extract structured data
    try:
        bedrock = boto3.client("bedrock-runtime", region_name=Config.AWS_REGION)

        prompt = f"""Extract course information from this university catalogue page text. Return ONLY a JSON object with these fields (use null for missing data):

- title: full course title
- credits: number of credits (as a number)
- credit_type: "semester hours" or "quarter hours"
- description: course description text
- prerequisites: prerequisites text (just the requirements, not institutional boilerplate)
- corequisites: corequisites if any
- department: department name
- college: college name
- level: "lower division", "upper division", "graduate", or "doctoral"
- grade_mode: grading mode if listed
- repeat_status: repeat policy if listed

Page text:
{text[:3000]}"""

        response = bedrock.invoke_model(
            modelId="anthropic.claude-3-haiku-20240307-v1:0",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1000,
                "messages": [{"role": "user", "content": prompt}],
            }),
            contentType="application/json",
        )

        result = json.loads(response["body"].read())
        answer = result["content"][0]["text"].strip()

        # Extract JSON from response (handle markdown code blocks)
        if "```" in answer:
            answer = answer.split("```")[1]
            if answer.startswith("json"):
                answer = answer[4:]
            answer = answer.strip()

        parsed = json.loads(answer)

        # Merge with URL-extracted data
        for key, value in parsed.items():
            if value is not None and value != "":
                data[key] = value

        # Infer level from course number if not provided
        if not data.get("level") and data.get("course_number"):
            num = int(data["course_number"])
            if num < 1000:
                data["level"] = "remedial"
            elif num < 3000:
                data["level"] = "lower division"
            elif num < 5000:
                data["level"] = "upper division"
            elif num < 7000:
                data["level"] = "graduate"
            else:
                data["level"] = "doctoral"

        logger.info("Bedrock parsed course %s: title=%s", data.get("course_code"), data.get("title"))
        return data

    except Exception as exc:
        logger.warning("Bedrock parsing failed for %s: %s. Using basic extraction.", url, exc)
        # Minimal fallback — just store what we can from URL
        return data


# ---------------------------------------------------------------------------
# Bulk scraping for an institution
# ---------------------------------------------------------------------------

def scrape_courses_for_institution(institution_id: int, course_codes: list[str]) -> list[dict]:
    """
    Given an institution and a list of course codes, scrape each one.

    Uses the institution's catalogue_url_pattern to construct URLs.
    Returns a list of results (one per course code).
    """
    session = get_session()
    try:
        inst = session.get(Institution, institution_id)
        if not inst:
            return [{"error": f"Institution {institution_id} not found"}]

        url_pattern = inst.catalogue_url_pattern
        source_type = inst.catalogue_source_type or "individual_url"
        method = "simple"  # default; could be stored per institution later
    finally:
        session.close()

    if not url_pattern:
        return [{"error": "No catalogue URL pattern configured for this institution"}]

    results = []
    for code in course_codes:
        # Normalize code: remove spaces → "SPAN 3117" → "SPAN3117"
        normalized = code.replace(" ", "").upper()

        # Extract prefix and number
        code_match = re.match(r"([A-Z]+)(\d+)", normalized)
        if not code_match:
            results.append({"course_code": code, "error": f"Cannot parse code: {code}"})
            continue

        prefix = code_match.group(1)
        number = code_match.group(2)

        # Build URL from pattern
        url = url_pattern.replace("{PREFIX}", prefix).replace("{NUMBER}", number)
        # Also handle combined {CODE} placeholder
        url = url.replace("{CODE}", normalized)

        logger.info("Scraping catalogue: %s → %s", code, url)

        # Check if already scraped
        session = get_session()
        try:
            existing = (
                session.query(CatalogueCourse)
                .filter(
                    CatalogueCourse.institution_id == institution_id,
                    CatalogueCourse.course_code == normalized,
                )
                .first()
            )
            if existing:
                results.append({
                    "course_code": normalized,
                    "status": "already_scraped",
                    "course_id": existing.id,
                    "title": existing.title,
                })
                continue
        finally:
            session.close()

        # Scrape
        result = scrape_course_url(institution_id, url, method=method)
        result["course_code"] = normalized
        results.append(result)

    return results


# ---------------------------------------------------------------------------
# Lookup courses from a transcript
# ---------------------------------------------------------------------------

def lookup_transcript_courses(transcript_id: int) -> list[dict]:
    """
    Given a transcript ID, find the institution and scrape catalogue data
    for each course on the transcript.

    Returns list of scrape results.
    """
    from database import Student, Course

    session = get_session()
    try:
        student = session.query(Student).filter(Student.transcript_id == transcript_id).first()
        if not student:
            return [{"error": "No student found for this transcript"}]

        institution_name = student.institution
        institution_website = student.institution_website

        if not institution_name:
            return [{"error": "No institution name on this transcript"}]

        # Get course codes
        courses = session.query(Course).filter(Course.student_id == student.id).all()
        course_codes = [c.course_code for c in courses if c.course_code]

        if not course_codes:
            return [{"error": "No course codes found on this transcript"}]

    finally:
        session.close()

    # Get or create institution
    institution_id = get_or_create_institution(
        name=institution_name,
        website=institution_website,
    )

    # Check if URL pattern is set
    session = get_session()
    try:
        inst = session.get(Institution, institution_id)
        if not inst.catalogue_url_pattern:
            return [{
                "error": f"No catalogue URL pattern set for '{institution_name}'. "
                         f"Set it via the institutions table or API.",
                "institution_id": institution_id,
            }]
    finally:
        session.close()

    # Scrape
    return scrape_courses_for_institution(institution_id, course_codes)
