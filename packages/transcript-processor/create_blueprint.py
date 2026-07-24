"""
One-time script to create the student transcript Blueprint in BDA
and attach it to the existing project.

Run this once from CloudShell:
  python3 create_blueprint.py

It will print the blueprint ARN — add that to your Lambda environment
variables as BDA_BLUEPRINT_ARN.
"""

import json
import os
import boto3

AWS_REGION   = os.environ.get("AWS_REGION", "us-west-2")
PROJECT_NAME = os.environ.get("BDA_PROJECT_NAME", "student-transcript-processor")

# -----------------------------------------------------------------------
# Blueprint schema
# Each field has: type, inferenceType, description
# BDA's AI uses the description to find the right value regardless of
# how the transcript is formatted.
# -----------------------------------------------------------------------
BLUEPRINT_SCHEMA = {
    "class": "StudentTranscript",
    "description": "Extracts student personal information and academic course records from university and college transcripts in any format.",
    "properties": {

        # --- Personal information ---
        "student_name": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Full name of the student as it appears on the transcript."
        },
        "student_id": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Student ID, student number, or enrollment number on the transcript."
        },
        "date_of_birth": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Student date of birth. Return in MM/DD/YYYY format if available."
        },
        "email": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Student email address if present on the transcript."
        },
        "phone": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Student phone number if present on the transcript."
        },
        "address": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Student mailing or home address if present on the transcript."
        },

        # --- Academic institution ---
        "institution": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Full name of the college or university that issued the transcript."
        },
        "program": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Degree program, e.g. Bachelor of Science, Associate in Arts, Associate in Pre-Nursing DTA/MRP."
        },
        "major": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Student declared major or field of study."
        },
        "minor": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Student declared minor if present."
        },
        "enrollment_date": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Date the student first enrolled at the institution."
        },
        "graduation_date": {
            "type": "string",
            "inferenceType": "explicit",
            "instruction": "Degree conferral or graduation date. Also called Confer Date."
        },
        "gpa": {
            "type": "number",
            "inferenceType": "explicit",
            "instruction": "Cumulative GPA as a number, e.g. 3.75. Also called Cum GPA, QPR, or overall GPA. Use the final cumulative value."
        },
        "total_credits": {
            "type": "number",
            "inferenceType": "explicit",
            "instruction": "Total credits earned across all terms. Also called Cum Totals earned credits or total hours earned."
        },

        # --- Courses ---
        "courses": {
            "type": "array",
            "inferenceType": "explicit",
            "instruction": "List of every course taken by the student across all terms and semesters. Include transfer courses.",
            "items": {
                "type": "object",
                "properties": {
                    "course_code": {
                        "type": "string",
                        "inferenceType": "explicit",
                        "instruction": "Course code or number, e.g. MATH 151, DHYG124, CS 301."
                    },
                    "course_name": {
                        "type": "string",
                        "inferenceType": "explicit",
                        "instruction": "Full course title, e.g. Calculus, Dental Radiology, Introduction to Psychology."
                    },
                    "credits": {
                        "type": "number",
                        "inferenceType": "explicit",
                        "instruction": "Credit hours earned. Also called units or earned hours."
                    },
                    "grade": {
                        "type": "string",
                        "inferenceType": "explicit",
                        "instruction": "Letter grade received, e.g. A, B+, C-, W, TR for transfer, S for satisfactory."
                    },
                    "grade_points": {
                        "type": "number",
                        "inferenceType": "explicit",
                        "instruction": "Quality points or grade points earned for this course, e.g. 12.00, 16.65."
                    },
                    "semester": {
                        "type": "string",
                        "inferenceType": "explicit",
                        "instruction": "Term when the course was taken, e.g. FALL 2018, SPRING 2007, WINTER 2019."
                    },
                    "year": {
                        "type": "string",
                        "inferenceType": "explicit",
                        "instruction": "Academic year when the course was taken, e.g. 2018, 2022."
                    },
                    "department": {
                        "type": "string",
                        "inferenceType": "explicit",
                        "instruction": "Department code, e.g. MATH, DHYG, ENGL."
                    },
                    "status": {
                        "type": "string",
                        "inferenceType": "explicit",
                        "instruction": "Course status: Completed, Transfer, Withdrawn, or In Progress."
                    }
                }
            }
        }
    }
}


def main():
    client = boto3.client("bedrock-data-automation", region_name=AWS_REGION)

    # ---- Create blueprint ----
    print("Creating blueprint...")
    response = client.create_blueprint(
        blueprintName="student-transcript-blueprint",
        type="DOCUMENT",
        blueprintStage="LIVE",
        schema=json.dumps(BLUEPRINT_SCHEMA),
    )
    blueprint = response["blueprint"]
    blueprint_arn = blueprint["blueprintArn"]
    print(f"Blueprint created: {blueprint_arn}")

    # ---- Find the project ----
    print(f"Looking for project '{PROJECT_NAME}'...")
    project_arn = None
    paginator = client.get_paginator("list_data_automation_projects")
    for page in paginator.paginate():
        for p in page.get("projects", []):
            if p.get("projectName") == PROJECT_NAME:
                project_arn = p["projectArn"]
                break

    if not project_arn:
        print(f"Project '{PROJECT_NAME}' not found. Create it first or set BDA_PROJECT_ARN.")
        return

    print(f"Found project: {project_arn}")

    # ---- Attach blueprint to project ----
    print("Attaching blueprint to project...")

    # Get current project config
    project = client.get_data_automation_project(projectArn=project_arn)["project"]

    # Build updated custom output configuration
    custom_config = project.get("customOutputConfiguration") or {}
    blueprints = custom_config.get("blueprints") or []

    # Add blueprint if not already attached
    already_attached = any(b.get("blueprintArn") == blueprint_arn for b in blueprints)
    if not already_attached:
        blueprints.append({
            "blueprintArn": blueprint_arn,
            "blueprintStage": "LIVE",
        })

    client.update_data_automation_project(
        projectArn=project_arn,
        standardOutputConfiguration=project.get("standardOutputConfiguration", {}),
        customOutputConfiguration={"blueprints": blueprints},
    )
    print("Blueprint attached to project.")

    print("\n" + "="*60)
    print("SUCCESS. Add this to your Lambda environment variables:")
    print(f"  BDA_BLUEPRINT_ARN = {blueprint_arn}")
    print("="*60)


if __name__ == "__main__":
    main()
