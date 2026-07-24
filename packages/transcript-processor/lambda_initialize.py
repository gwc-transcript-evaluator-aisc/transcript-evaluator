"""CloudFormation custom-resource handler that initializes the processor schema."""

from config import Config
from database import init_db


def handler(event, context):
    """Create the SQLAlchemy-managed schema; deletion intentionally retains data."""
    if event.get("RequestType") in ("Create", "Update"):
        init_db(Config.db_url())
    return {"PhysicalResourceId": "transcript-processor-schema"}
