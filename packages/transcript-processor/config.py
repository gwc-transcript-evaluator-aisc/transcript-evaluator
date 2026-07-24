"""Runtime configuration for the transcript processor Lambdas."""

import json
import os
from functools import lru_cache
from urllib.parse import quote_plus


class Config:
    AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")
    S3_BUCKET_INPUT = os.environ["S3_BUCKET_INPUT"]
    S3_BUCKET_OUTPUT = os.environ["S3_BUCKET_OUTPUT"]
    S3_INPUT_PREFIX = os.environ.get("S3_INPUT_PREFIX", "transcripts/")
    S3_OUTPUT_PREFIX = os.environ.get("S3_OUTPUT_PREFIX", "bda-output/")
    BDA_PROJECT_NAME = os.environ.get("BDA_PROJECT_NAME", "student-transcript-processor")
    BDA_PROJECT_ARN = os.environ.get("BDA_PROJECT_ARN", "")
    BDA_PROFILE_ARN = os.environ["BDA_PROFILE_ARN"]
    BDA_BLUEPRINT_ARN = os.environ.get("BDA_BLUEPRINT_ARN", "")
    BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-5")
    DB_HOST = os.environ["DB_HOST"]
    DB_PORT = int(os.environ.get("DB_PORT", "5432"))
    DB_NAME = os.environ.get("DB_NAME", "transcripts")
    DB_USER = os.environ.get("DB_USER", "transcript_processor")
    DB_SECRET_ARN = os.environ.get("DB_SECRET_ARN", "")

    @classmethod
    @lru_cache(maxsize=1)
    def db_password(cls) -> str:
        """Read the generated database secret once per warm Lambda environment."""
        if cls.DB_SECRET_ARN:
            import boto3
            value = boto3.client("secretsmanager", region_name=cls.AWS_REGION).get_secret_value(
                SecretId=cls.DB_SECRET_ARN
            )["SecretString"]
            return json.loads(value)["password"]
        return os.environ["DB_PASSWORD"]

    @classmethod
    def db_url(cls) -> str:
        return (
            f"postgresql+psycopg2://{quote_plus(cls.DB_USER)}:{quote_plus(cls.db_password())}"
            f"@{cls.DB_HOST}:{cls.DB_PORT}/{cls.DB_NAME}"
        )
