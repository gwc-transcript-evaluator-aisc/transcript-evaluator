import ast
import json
from pathlib import Path
import unittest


PACKAGE_DIRECTORY = Path(__file__).resolve().parent.parent
BLUEPRINT_SCRIPT = PACKAGE_DIRECTORY / "create_blueprint.py"
CANONICAL_SCHEMA = PACKAGE_DIRECTORY / "blueprints" / "student-transcript-schema.json"


def load_manual_blueprint_schema():
    module = ast.parse(BLUEPRINT_SCRIPT.read_text())
    for statement in module.body:
        if (
            isinstance(statement, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "BLUEPRINT_SCHEMA" for target in statement.targets)
        ):
            return ast.literal_eval(statement.value)
    raise AssertionError("BLUEPRINT_SCHEMA was not found in create_blueprint.py")


class BlueprintSchemaTest(unittest.TestCase):
    def test_canonical_schema_matches_manual_blueprint_and_json_dumps_payload(self):
        canonical_schema = json.loads(CANONICAL_SCHEMA.read_text())
        manual_schema = load_manual_blueprint_schema()

        self.assertEqual(canonical_schema, manual_schema)
        self.assertEqual(json.dumps(canonical_schema), json.dumps(manual_schema))


if __name__ == "__main__":
    unittest.main()
