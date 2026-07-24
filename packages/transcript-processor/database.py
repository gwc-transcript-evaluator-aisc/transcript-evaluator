"""
Database models and session management — PostgreSQL via psycopg2 + SQLAlchemy.

Lambda execution model notes:
  - Each Lambda invocation may reuse a warm container, so we cache the engine
    at module level to reuse connections across warm invocations.
  - We use NullPool to avoid holding idle connections between invocations,
    which would exhaust Aurora's connection limit under concurrent load.

Tables:
  - transcripts  : one row per uploaded PDF (metadata + processing status)
  - students     : personal information extracted from a transcript
  - courses      : individual course records linked to a student
  - audit_log    : chronological log of reviews and edits
"""

from datetime import datetime, timezone
import enum

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Float,
    ForeignKey,
    Enum as SAEnum,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from sqlalchemy.pool import NullPool


Base = declarative_base()


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ProcessingStatus(str, enum.Enum):
    PENDING   = "pending"    # uploaded to S3, BDA job not yet submitted
    SUBMITTED = "submitted"  # BDA job invoked, waiting for S3 result
    COMPLETED = "completed"  # result parsed and stored
    FAILED    = "failed"     # error at any stage


class ReviewStatus(str, enum.Enum):
    UNREVIEWED    = "unreviewed"     # not yet looked at by a human
    IN_REVIEW     = "in_review"      # currently being reviewed (locked)
    VERIFIED      = "verified"       # human confirmed data is correct
    FLAGGED_RERUN = "flagged_rerun"  # marked for BDA reprocessing


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Transcript(Base):
    """Tracks each uploaded PDF through the pipeline."""
    __tablename__ = "transcripts"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    original_filename    = Column(String(255), nullable=False)
    s3_input_key         = Column(String(512), nullable=False, unique=True)
    s3_output_prefix     = Column(String(512))
    bda_invocation_arn   = Column(String(512))
    status               = Column(SAEnum(ProcessingStatus), nullable=False,
                                  default=ProcessingStatus.PENDING)
    error_message        = Column(Text)
    uploaded_at          = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    processed_at         = Column(DateTime)

    # Review / verification
    review_status        = Column(SAEnum(ReviewStatus), nullable=False,
                                  default=ReviewStatus.UNREVIEWED)
    reviewed_by          = Column(String(255))     # who locked / last reviewed
    reviewed_at          = Column(DateTime)        # when review_status last changed
    review_locked_at     = Column(DateTime)        # when in_review lock was acquired

    student = relationship(
        "Student", back_populates="transcript",
        uselist=False, cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Transcript id={self.id} file={self.original_filename!r} status={self.status}>"


class Student(Base):
    """Personal and academic information extracted from a transcript."""
    __tablename__ = "students"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    transcript_id   = Column(Integer, ForeignKey("transcripts.id"),
                             nullable=False, unique=True)

    # Identity
    full_name       = Column(String(255))
    student_id      = Column(String(100))
    date_of_birth   = Column(String(50))
    email           = Column(String(255))
    phone           = Column(String(50))
    address         = Column(Text)

    # Academic
    institution     = Column(String(255))
    institution_address = Column(Text)
    institution_website = Column(String(512))
    institution_phone   = Column(String(50))
    program         = Column(String(255))
    major           = Column(String(255))
    minor           = Column(String(255))
    enrollment_date = Column(String(50))
    graduation_date = Column(String(50))
    gpa             = Column(Float)
    total_credits   = Column(Float)

    # Full extracted text as fallback
    raw_text        = Column(Text)
    created_at      = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    transcript = relationship("Transcript", back_populates="student")
    courses    = relationship("Course", back_populates="student",
                              cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Student id={self.id} name={self.full_name!r}>"


class Course(Base):
    """A single course entry on a student transcript."""
    __tablename__ = "courses"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    student_id  = Column(Integer, ForeignKey("students.id"), nullable=False)

    course_code = Column(String(50))
    course_name = Column(String(255))
    credits     = Column(Float)
    grade       = Column(String(10))
    grade_points= Column(Float)
    term        = Column(String(100))    # original term value from BDA
    term_season = Column(String(50))     # extracted: FALL, SPRING, SUMMER, WINTER, etc.
    term_year   = Column(String(10))     # extracted: 2020, 2021, etc.
    year        = Column(String(10))
    instructor  = Column(String(255))
    department  = Column(String(255))
    status      = Column(String(50))
    created_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    student = relationship("Student", back_populates="courses")

    def __repr__(self):
        return f"<Course id={self.id} code={self.course_code!r} grade={self.grade!r}>"


class GradingLegend(Base):
    """Grade symbol definitions extracted from a transcript's grading policy."""
    __tablename__ = "grading_legend"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    transcript_id  = Column(Integer, ForeignKey("transcripts.id"), nullable=False)
    symbol         = Column(String(20), nullable=False)
    meaning        = Column(String(500))
    grade_points   = Column(String(50))
    created_at     = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f"<GradingLegend id={self.id} symbol={self.symbol!r} meaning={self.meaning!r}>"


# ---------------------------------------------------------------------------
# Course Catalogue Models
# ---------------------------------------------------------------------------

class Institution(Base):
    """An educational institution whose catalogue we track."""
    __tablename__ = "institutions"

    id                    = Column(Integer, primary_key=True, autoincrement=True)
    name                  = Column(String(255), nullable=False, unique=True)
    website               = Column(String(512))
    catalogue_source_type = Column(String(50))    # individual_url, department_page, pdf, search_api, manual
    catalogue_url_pattern = Column(String(512))   # e.g. "https://catalog.usu.edu/courses/{PREFIX}{NUMBER}"
    credit_system         = Column(String(50))    # semester, quarter
    notes                 = Column(Text)
    created_at            = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at            = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    pages   = relationship("CataloguePage", back_populates="institution", cascade="all, delete-orphan")
    courses = relationship("CatalogueCourse", back_populates="institution", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Institution id={self.id} name={self.name!r}>"


class CataloguePage(Base):
    """A raw scraped page from an institution's course catalogue."""
    __tablename__ = "catalogue_pages"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    institution_id   = Column(Integer, ForeignKey("institutions.id"), nullable=False)
    url              = Column(String(1024))       # source URL (or filename for PDFs)
    raw_content      = Column(Text)               # full scraped text content
    content_type     = Column(String(50))         # text/html, application/pdf, text/plain
    scraped_at       = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    status           = Column(String(50), default="scraped")  # scraped, parsed, error

    institution = relationship("Institution", back_populates="pages")

    def __repr__(self):
        return f"<CataloguePage id={self.id} url={self.url!r}>"


class CatalogueCourse(Base):
    """A parsed course from an institution's catalogue."""
    __tablename__ = "catalogue_courses"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    institution_id   = Column(Integer, ForeignKey("institutions.id"), nullable=False)
    page_id          = Column(Integer, ForeignKey("catalogue_pages.id"))  # which page it was parsed from
    course_code      = Column(String(50))         # e.g. "SPAN3117" or "SPAN 3117"
    course_prefix    = Column(String(20))         # e.g. "SPAN"
    course_number    = Column(String(20))         # e.g. "3117"
    title            = Column(String(500))
    credits          = Column(Float)
    credit_type      = Column(String(50))         # semester hours, quarter hours, etc.
    description      = Column(Text)
    prerequisites    = Column(Text)
    corequisites     = Column(Text)
    department       = Column(String(255))
    college          = Column(String(255))
    level            = Column(String(50))         # undergraduate, graduate, etc.
    grade_mode       = Column(String(100))
    repeat_status    = Column(String(100))
    raw_content      = Column(Text)               # full raw text for this specific course entry
    created_at       = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at       = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    institution = relationship("Institution", back_populates="courses")

    def __repr__(self):
        return f"<CatalogueCourse id={self.id} code={self.course_code!r} title={self.title!r}>"


class AuditLog(Base):
    """Chronological log of all reviews and edits."""
    __tablename__ = "audit_log"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    transcript_id  = Column(Integer, ForeignKey("transcripts.id"), nullable=False)
    table_name     = Column(String(50), nullable=False)    # "students" or "courses"
    record_id      = Column(Integer, nullable=False)       # PK of the row edited
    field_name     = Column(String(100))                   # column that was changed
    old_value      = Column(Text)                          # previous value (as string)
    new_value      = Column(Text)                          # updated value (as string)
    action         = Column(String(50), nullable=False)    # edit / review_started / verified / flagged_rerun / course_added / course_deleted
    user_name      = Column(String(255), nullable=False)   # who made the change
    created_at     = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f"<AuditLog id={self.id} action={self.action!r} table={self.table_name} record={self.record_id}>"


# ---------------------------------------------------------------------------
# Engine / session — module-level cache for Lambda warm reuse
# ---------------------------------------------------------------------------

_engine         = None
_SessionFactory = None


def init_db(db_url: str) -> None:
    """
    Create the engine and all tables.
    Safe to call on every Lambda cold start — CREATE TABLE IF NOT EXISTS is idempotent.
    NullPool ensures no connections are held between invocations.
    """
    global _engine, _SessionFactory

    _engine = create_engine(
        db_url,
        poolclass=NullPool,   # no persistent connection pool — safe for Lambda
        pool_pre_ping=True,   # auto-recover stale connections
        echo=False,
    )
    Base.metadata.create_all(_engine)
    _SessionFactory = sessionmaker(bind=_engine, autoflush=False, autocommit=False)


def get_session():
    """Return a new SQLAlchemy session. Caller must close it."""
    if _SessionFactory is None:
        raise RuntimeError("Database not initialised. Call init_db() first.")
    return _SessionFactory()
