"""
Generate fake student transcript PDFs for testing.

Usage (run in CloudShell):
  pip install reportlab
  python3 generate_transcripts.py --count 10 --output ./sample_transcripts/

Each PDF contains:
  - Random student name, ID, DOB
  - Random institution
  - Random program/major
  - 8-25 random courses with codes, names, credits, grades, semesters
  - Cumulative GPA and total credits
"""

import argparse
import os
import random
import string
from datetime import date, timedelta

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle


# ---------------------------------------------------------------------------
# Data pools
# ---------------------------------------------------------------------------

FIRST_NAMES = [
    "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael",
    "Linda", "David", "Elizabeth", "William", "Barbara", "Richard", "Susan",
    "Joseph", "Jessica", "Thomas", "Sarah", "Daniel", "Karen", "Matthew",
    "Lisa", "Anthony", "Nancy", "Mark", "Betty", "Steven", "Margaret",
    "Andrew", "Sandra", "Joshua", "Ashley", "Kevin", "Kimberly", "Brian",
    "Emily", "George", "Donna", "Edward", "Michelle", "Ryan", "Carol",
    "Timothy", "Amanda", "Jason", "Melissa", "Jeffrey", "Deborah",
    "Nathan", "Stephanie", "Carlos", "Maria", "Wei", "Yuki", "Amir",
    "Priya", "Jamal", "Fatima", "Hiroshi", "Ananya", "Omar", "Svetlana",
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
    "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
    "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
    "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
    "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King",
    "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green",
    "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
    "Kim", "Chen", "Patel", "Singh", "Tanaka", "Okafor", "Johansson",
]

INSTITUTIONS = [
    "South Puget Sound Community College",
    "University of Bridgeport",
    "Golden West College",
    "Stanbridge University",
    "Portland Community College",
    "Seattle Central College",
    "San Jose State University",
    "University of California, Irvine",
    "Oregon State University",
    "Washington State University",
    "Bellevue College",
    "Tacoma Community College",
    "Santa Monica College",
    "Houston Community College",
    "Miami Dade College",
]

PROGRAMS = [
    "Associate in Arts",
    "Associate in Science",
    "Associate in Pre-Nursing DTA/MRP",
    "Bachelor of Science",
    "Bachelor of Arts",
    "Associate in Applied Science",
]

MAJORS = [
    "Computer Science", "Biology", "Nursing", "Business Administration",
    "Psychology", "English", "Mathematics", "Dental Hygiene",
    "Criminal Justice", "Engineering", "Communications", "Sociology",
    "Chemistry", "Education", "Accounting", "Graphic Design",
    "Information Technology", "Political Science", "Economics", "Music",
]

DEPARTMENTS = [
    "MATH", "ENGL", "BIOL", "CHEM", "PHYS", "PSYC", "HIST", "ECON",
    "CMST", "MUSC", "ART", "SOC", "POLS", "CS", "NURS", "ACCT",
    "MGMT", "SPAN", "PHIL", "ANTH", "GEOL", "ASTR",
]

COURSE_NAMES = {
    "MATH": ["College Algebra", "Calculus I", "Calculus II", "Statistics",
             "Linear Algebra", "Precalculus", "Discrete Mathematics", "Trigonometry"],
    "ENGL": ["English Composition I", "English Composition II", "Creative Writing",
             "American Literature", "British Literature", "Technical Writing"],
    "BIOL": ["General Biology", "Human Anatomy & Physiology I", "Human Anatomy & Physiology II",
             "Microbiology", "Genetics", "Ecology", "Cell Biology"],
    "CHEM": ["General Chemistry I", "General Chemistry II", "Organic Chemistry I",
             "Organic Chemistry II", "Biochemistry", "Intro to Chemistry"],
    "PHYS": ["General Physics I", "General Physics II", "Mechanics", "Electromagnetism"],
    "PSYC": ["Introduction to Psychology", "Developmental Psychology", "Abnormal Psychology",
             "Social Psychology", "Research Methods in Psychology"],
    "HIST": ["U.S. History to 1877", "U.S. History Since 1877", "World History I",
             "World History II", "Western Civilization"],
    "ECON": ["Microeconomics", "Macroeconomics", "International Economics"],
    "CMST": ["Public Speaking", "Interpersonal Communication", "Mass Communication"],
    "MUSC": ["Music Appreciation", "Music Fundamentals", "Music Theory I"],
    "ART":  ["Art Appreciation", "Drawing I", "Painting I", "Art History"],
    "SOC":  ["Introduction to Sociology", "Race and Ethnicity", "Social Problems"],
    "POLS": ["American Government", "Comparative Politics", "International Relations"],
    "CS":   ["Intro to Computer Science", "Programming I", "Programming II",
             "Data Structures", "Database Systems", "Web Development"],
    "NURS": ["Nursing Fundamentals I", "Nursing Fundamentals II", "Pharmacology",
             "Clinical Practice I", "Clinical Practice II", "Community Health"],
    "ACCT": ["Financial Accounting", "Managerial Accounting", "Cost Accounting"],
    "MGMT": ["Principles of Management", "Organizational Behavior", "Human Resources"],
    "SPAN": ["Spanish I", "Spanish II", "Intermediate Spanish"],
    "PHIL": ["Introduction to Philosophy", "Ethics", "Logic"],
    "ANTH": ["Cultural Anthropology", "Physical Anthropology", "Archaeology"],
    "GEOL": ["Physical Geology", "Historical Geology", "Environmental Geology"],
    "ASTR": ["Introduction to Astronomy", "Observational Astronomy"],
}

GRADES = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F"]
GRADE_POINTS = {
    "A": 4.0, "A-": 3.67, "B+": 3.33, "B": 3.0, "B-": 2.67,
    "C+": 2.33, "C": 2.0, "C-": 1.67, "D+": 1.33, "D": 1.0, "F": 0.0,
}

SEMESTERS = ["FALL", "WINTER", "SPRING", "SUMMER"]


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------

def random_date(start_year=1985, end_year=2005):
    start = date(start_year, 1, 1)
    end = date(end_year, 12, 31)
    delta = (end - start).days
    return start + timedelta(days=random.randint(0, delta))


def generate_student():
    """Generate a random student profile."""
    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    return {
        "name": f"{first} {last}",
        "student_id": f"{random.randint(100000, 999999)}",
        "dob": random_date(1985, 2005).strftime("%m/%d/%Y"),
        "institution": random.choice(INSTITUTIONS),
        "program": random.choice(PROGRAMS),
        "major": random.choice(MAJORS),
        "address": f"{random.randint(100, 9999)} {random.choice(['Oak', 'Elm', 'Pine', 'Maple', 'Cedar', 'Main', 'Park'])} {random.choice(['St', 'Ave', 'Blvd', 'Dr', 'Ln'])}, {random.choice(['Seattle', 'Portland', 'Tacoma', 'Olympia', 'Irvine', 'Houston', 'Miami'])}, WA {random.randint(98001, 98999)}",
    }


def generate_courses(num_semesters=None):
    """Generate random courses across multiple semesters."""
    if num_semesters is None:
        num_semesters = random.randint(3, 8)

    start_year = random.randint(2017, 2023)
    courses = []

    for i in range(num_semesters):
        semester = SEMESTERS[i % 4]
        year = start_year + (i // 4)
        term_label = f"{semester} {year}"

        # 2-5 courses per semester
        num_courses = random.randint(2, 5)
        for _ in range(num_courses):
            dept = random.choice(DEPARTMENTS)
            course_num = random.randint(100, 399)
            name = random.choice(COURSE_NAMES.get(dept, ["Special Topics"]))
            credits = random.choice([3.0, 4.0, 5.0, 1.0, 2.0])
            grade = random.choice(GRADES)
            points = GRADE_POINTS[grade] * credits

            courses.append({
                "code": f"{dept} {course_num}",
                "name": name,
                "credits": credits,
                "grade": grade,
                "points": round(points, 2),
                "semester": term_label,
            })

    return courses


def calculate_gpa(courses):
    """Calculate cumulative GPA from courses."""
    total_points = sum(c["points"] for c in courses)
    total_credits = sum(c["credits"] for c in courses)
    if total_credits == 0:
        return 0.0, 0.0
    return round(total_points / total_credits, 3), total_credits


# ---------------------------------------------------------------------------
# PDF Generation
# ---------------------------------------------------------------------------

def create_transcript_pdf(filepath, student, courses, gpa, total_credits):
    """Create a PDF transcript document."""
    doc = SimpleDocTemplate(
        filepath,
        pagesize=letter,
        rightMargin=0.75 * inch,
        leftMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TranscriptTitle",
        parent=styles["Heading1"],
        fontSize=14,
        alignment=1,  # center
        spaceAfter=6,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle",
        parent=styles["Normal"],
        fontSize=9,
        alignment=1,
        spaceAfter=12,
    )
    heading_style = ParagraphStyle(
        "SectionHead",
        parent=styles["Heading2"],
        fontSize=10,
        spaceBefore=12,
        spaceAfter=4,
    )
    normal_style = ParagraphStyle(
        "TranscriptNormal",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
    )

    elements = []

    # Header
    elements.append(Paragraph("OFFICIAL TRANSCRIPT OF ACADEMIC RECORD", title_style))
    elements.append(Paragraph(student["institution"], subtitle_style))
    elements.append(Spacer(1, 12))

    # Student info table
    info_data = [
        ["Name:", student["name"], "Student ID:", student["student_id"]],
        ["Date of Birth:", student["dob"], "Program:", student["program"]],
        ["Major:", student["major"], "Address:", student["address"]],
    ]
    info_table = Table(info_data, colWidths=[1.2 * inch, 2.3 * inch, 1.2 * inch, 2.3 * inch])
    info_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 12))

    # Degree info
    elements.append(Paragraph(
        f"Degree: {student['program']} in {student['major']}", normal_style
    ))
    elements.append(Spacer(1, 8))

    # Courses by semester
    current_semester = None
    semester_courses = []

    for course in courses:
        if course["semester"] != current_semester:
            if current_semester and semester_courses:
                elements.extend(_render_semester(current_semester, semester_courses, heading_style))
            current_semester = course["semester"]
            semester_courses = [course]
        else:
            semester_courses.append(course)

    # Render last semester
    if semester_courses:
        elements.extend(_render_semester(current_semester, semester_courses, heading_style))

    # Cumulative summary
    elements.append(Spacer(1, 16))
    elements.append(Paragraph(f"Cumulative GPA: {gpa:.3f}", heading_style))
    elements.append(Paragraph(
        f"Total Credits Earned: {total_credits:.1f}", normal_style
    ))
    elements.append(Spacer(1, 20))

    # Footer
    elements.append(Paragraph(
        "CONFIDENTIAL RECORD ISSUED IN ACCORDANCE WITH THE FAMILY EDUCATIONAL "
        "RIGHTS AND PRIVACY ACT OF 1974",
        ParagraphStyle("Footer", parent=styles["Normal"], fontSize=7, alignment=1),
    ))
    elements.append(Spacer(1, 12))
    elements.append(Paragraph(
        "End of Official Transcript",
        ParagraphStyle("EndMark", parent=styles["Normal"], fontSize=8,
                       alignment=1, fontName="Helvetica-Bold"),
    ))

    doc.build(elements)


def _render_semester(semester_name, courses, heading_style):
    """Render a semester section with course table."""
    elements = []
    elements.append(Paragraph(semester_name, heading_style))

    # Table header
    data = [["Course", "Title", "Credits", "Grade", "Points"]]
    for c in courses:
        data.append([
            c["code"],
            c["name"],
            f"{c['credits']:.1f}",
            c["grade"],
            f"{c['points']:.2f}",
        ])

    # Term totals
    term_credits = sum(c["credits"] for c in courses)
    term_points = sum(c["points"] for c in courses)
    term_gpa = term_points / term_credits if term_credits > 0 else 0
    data.append([
        "", f"Term GPA: {term_gpa:.3f}",
        f"{term_credits:.1f}", "", f"{term_points:.2f}"
    ])

    table = Table(data, colWidths=[1.0 * inch, 2.8 * inch, 0.8 * inch, 0.7 * inch, 0.8 * inch])
    table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.9, 0.9, 0.9)),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.grey),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, colors.grey),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Oblique"),
    ]))
    elements.append(table)
    elements.append(Spacer(1, 6))
    return elements


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate fake transcript PDFs")
    parser.add_argument("--count", type=int, default=5, help="Number of transcripts to generate")
    parser.add_argument("--output", type=str, default="./sample_transcripts",
                        help="Output directory")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    for i in range(args.count):
        student = generate_student()
        courses = generate_courses()
        gpa, total_credits = calculate_gpa(courses)

        # Sanitize filename
        safe_name = student["name"].replace(" ", "_")
        filename = f"{safe_name}_{student['student_id']}.pdf"
        filepath = os.path.join(args.output, filename)

        create_transcript_pdf(filepath, student, courses, gpa, total_credits)
        print(f"[{i+1}/{args.count}] Generated: {filename}  "
              f"({len(courses)} courses, GPA {gpa:.3f})")

    print(f"\nDone. {args.count} transcripts saved to: {args.output}/")


if __name__ == "__main__":
    main()
