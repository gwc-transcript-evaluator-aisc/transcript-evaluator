import importlib
import os
import unittest


class ConfigHandlerTest(unittest.TestCase):
    def setUp(self):
        self.previous = os.environ.copy()
        os.environ.update({
            "S3_BUCKET_INPUT": "input",
            "S3_BUCKET_OUTPUT": "output",
            "BDA_PROFILE_ARN": "arn:aws:bedrock:us-west-2:123456789012:data-automation-profile/us.data-automation-v1",
            "DB_HOST": "database.example.com",
            "DB_PASSWORD": "local-password",
        })

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.previous)

    def test_handler_model_defaults_to_required_sonnet_profile(self):
        import config
        importlib.reload(config)

        self.assertEqual(config.Config.BEDROCK_MODEL_ID, "us.anthropic.claude-sonnet-5")


if __name__ == "__main__":
    unittest.main()
