"""Unit tests for the bundled ``python_linter`` plugin's pure parsers.

These exercise :func:`parse_ruff_json` and :func:`parse_pyflakes_output` with
canned input — no ruff/pyflakes installation is required. Run from the repo
root::

    PYTHONPATH=python python3 -m unittest discover -s python/tests

(or ``python3 -m unittest python.tests.test_python_linter`` with ``python`` on
the path). The plugin module is loaded from ``examples/plugins/python_linter``
by file path so the test does not depend on that dir being importable.
"""

import importlib.util
import os
import sys
import unittest

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# The SDK package lives in python/; make `import snakie` work.
sys.path.insert(0, os.path.join(_REPO_ROOT, "python"))

_PLUGIN_PATH = os.path.join(
    _REPO_ROOT, "examples", "plugins", "python_linter", "__init__.py"
)
_spec = importlib.util.spec_from_file_location("snakie_python_linter_under_test", _PLUGIN_PATH)
assert _spec and _spec.loader
pl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pl)


def _item(diag):
    """Unwrap the ``snakie.diagnostic`` action form into its bare item dict."""
    return diag["item"] if diag.get("type") == "diagnostic" else diag


class RuffJsonParsing(unittest.TestCase):
    SAMPLE = """[
      {
        "code": "F401",
        "message": "`os` imported but unused",
        "location": {"row": 1, "column": 8},
        "end_location": {"row": 1, "column": 10},
        "fix": {
          "message": "Remove unused import: `os`",
          "edits": [
            {"content": "", "location": {"row": 1, "column": 1},
             "end_location": {"row": 2, "column": 1}}
          ]
        }
      },
      {
        "code": "W291",
        "message": "Trailing whitespace",
        "location": {"row": 3, "column": 10},
        "end_location": {"row": 3, "column": 13},
        "fix": null
      },
      {
        "code": "E999",
        "message": "SyntaxError: unexpected EOF",
        "location": {"row": 5, "column": 1},
        "end_location": {"row": 5, "column": 2},
        "fix": null
      }
    ]"""

    def test_maps_items_to_diagnostics(self):
        diags = [_item(d) for d in pl.parse_ruff_json(self.SAMPLE)]
        self.assertEqual(len(diags), 3)

        f401 = diags[0]
        self.assertEqual(f401["line"], 1)
        self.assertEqual(f401["column"], 8)
        self.assertEqual(f401["endLine"], 1)
        self.assertEqual(f401["endColumn"], 10)
        self.assertEqual(f401["message"], "F401: `os` imported but unused")
        self.assertEqual(f401["source"], "ruff")
        # F-codes are surfaced as errors.
        self.assertEqual(f401["severity"], "error")

    def test_builds_quick_fix_from_single_edit(self):
        f401 = _item(pl.parse_ruff_json(self.SAMPLE)[0])
        self.assertIn("fixes", f401)
        self.assertEqual(len(f401["fixes"]), 1)
        fix = f401["fixes"][0]
        self.assertEqual(fix["title"], "Remove unused import: `os`")
        self.assertEqual(fix["edit"]["newText"], "")
        self.assertEqual(fix["edit"]["line"], 1)
        self.assertEqual(fix["edit"]["column"], 1)
        self.assertEqual(fix["edit"]["endLine"], 2)
        self.assertEqual(fix["edit"]["endColumn"], 1)

    def test_no_fix_when_absent(self):
        w291 = _item(pl.parse_ruff_json(self.SAMPLE)[1])
        self.assertNotIn("fixes", w291)
        self.assertEqual(w291["severity"], "warning")

    def test_syntax_error_severity(self):
        e999 = _item(pl.parse_ruff_json(self.SAMPLE)[2])
        self.assertEqual(e999["severity"], "error")

    def test_empty_and_blank_input(self):
        self.assertEqual(pl.parse_ruff_json(""), [])
        self.assertEqual(pl.parse_ruff_json("   \n"), [])
        self.assertEqual(pl.parse_ruff_json("[]"), [])

    def test_invalid_json_is_safe(self):
        self.assertEqual(pl.parse_ruff_json("not json"), [])
        self.assertEqual(pl.parse_ruff_json('{"not": "a list"}'), [])


class PyflakesParsing(unittest.TestCase):
    FILE = "/tmp/snakie_lint_abc.py"

    def test_parses_path_line_col_message(self):
        text = (
            f"{self.FILE}:1:8: 'os' imported but unused\n"
            f"{self.FILE}:3:1: undefined name 'foo'\n"
        )
        diags = [_item(d) for d in pl.parse_pyflakes_output(text, self.FILE)]
        self.assertEqual(len(diags), 2)
        self.assertEqual(diags[0]["line"], 1)
        self.assertEqual(diags[0]["column"], 8)
        self.assertEqual(diags[0]["message"], "'os' imported but unused")
        self.assertEqual(diags[0]["severity"], "warning")
        self.assertEqual(diags[0]["source"], "pyflakes")
        self.assertNotIn("fixes", diags[0])
        self.assertEqual(diags[1]["line"], 3)
        self.assertEqual(diags[1]["column"], 1)

    def test_parses_line_only_form(self):
        text = f"{self.FILE}:5: invalid syntax\n"
        diags = [_item(d) for d in pl.parse_pyflakes_output(text, self.FILE)]
        self.assertEqual(len(diags), 1)
        self.assertEqual(diags[0]["line"], 5)
        self.assertNotIn("column", diags[0])
        self.assertEqual(diags[0]["message"], "invalid syntax")

    def test_ignores_unrelated_and_blank_lines(self):
        text = (
            "\n"
            "some banner without the path prefix\n"
            f"{self.FILE}:2:1: actually a finding\n"
        )
        diags = [_item(d) for d in pl.parse_pyflakes_output(text, self.FILE)]
        self.assertEqual(len(diags), 1)
        self.assertEqual(diags[0]["line"], 2)

    def test_empty_input(self):
        self.assertEqual(pl.parse_pyflakes_output("", self.FILE), [])


if __name__ == "__main__":
    unittest.main()
