"""The ``@plugin.refactor`` provider API (epic #634 §6, issue #808).

Mirrors ``@plugin.linter``: a plugin contributes refactorings, the host runs
them all and normalises whatever comes back. A school can ship its own
house-style rules this way, and the robot-specific rules can live in a plugin
rather than the core.

What matters most here is that a *broken* plugin cannot take the Refactor…
menu down with it, and that an offer with nothing to show never reaches the
editor — the editor's contract is that every offer previews as a diff.
"""
import unittest

from snakie import Context, fix, plugin, refactoring
from snakie.host import _run_refactor


SELECTION = {
    "startLine": 3,
    "startColumn": 1,
    "endLine": 3,
    "endColumn": 20,
    "text": 'print("hello")',
}


def _params(selection=SELECTION):
    context = {
        "file": {"path": "/p/main.py", "name": "main.py", "source": "local", "content": "x = 1\n"},
    }
    if selection is not None:
        context["selection"] = selection
    return {"context": context}


class RefactorRegistryTest(unittest.TestCase):
    def setUp(self):
        # The registry is a module-level singleton shared by every plugin, so
        # each test starts from a clean slate and restores what it found.
        self._saved = list(plugin.refactorings)
        plugin.refactorings.clear()

    def tearDown(self):
        plugin.refactorings[:] = self._saved

    def test_decorator_registers_a_provider_and_returns_the_function(self):
        @plugin.refactor("house-style")
        def provider(ctx):
            return []

        self.assertEqual(len(plugin.refactorings), 1)
        self.assertEqual(plugin.refactorings[0].name, "house-style")
        self.assertIs(plugin.refactorings[0].handler, provider)
        # The decorator must hand the function back unchanged.
        self.assertEqual(provider(None), [])

    def test_offers_reach_the_host_with_their_range_and_help_article(self):
        @plugin.refactor("house-style")
        def provider(ctx):
            return refactoring(
                "Use the school logger",
                "House style routes output through log()",
                fixes=[fix("Use log()", 'log("hello")', line=3, column=1, end_line=3, end_column=20)],
                line=3,
                column=1,
                end_line=3,
                end_column=20,
                help_article="school-logging",
                safe=True,
            )

        out = _run_refactor(_params())
        self.assertEqual(len(out["refactorings"]), 1)
        offer = out["refactorings"][0]
        self.assertEqual(offer["title"], "Use the school logger")
        self.assertEqual(offer["message"], "House style routes output through log()")
        self.assertEqual(offer["helpArticle"], "school-logging")
        self.assertEqual(offer["provider"], "house-style")
        self.assertTrue(offer["safe"])
        self.assertEqual((offer["line"], offer["endColumn"]), (3, 20))
        self.assertEqual(offer["fixes"][0]["edit"]["newText"], 'log("hello")')

    def test_a_single_offer_a_list_and_none_are_all_accepted(self):
        one = refactoring("A", "a", fixes=[fix("f", "x", line=1)])

        @plugin.refactor("single")
        def single(ctx):
            return one

        @plugin.refactor("many")
        def many(ctx):
            return [one, one]

        @plugin.refactor("quiet")
        def quiet(ctx):
            return None

        self.assertEqual(len(_run_refactor(_params())["refactorings"]), 3)

    def test_the_selection_reaches_the_provider(self):
        seen = {}

        @plugin.refactor("reader")
        def reader(ctx):
            seen["selection"] = ctx.selection
            return []

        _run_refactor(_params())
        self.assertIsNotNone(seen["selection"])
        self.assertEqual(seen["selection"].text, 'print("hello")')
        self.assertEqual(seen["selection"].start_line, 3)

    def test_a_provider_that_raises_is_skipped_not_fatal(self):
        @plugin.refactor("broken")
        def broken(ctx):
            raise RuntimeError("boom")

        @plugin.refactor("working")
        def working(ctx):
            return refactoring("Fine", "fine", fixes=[fix("f", "y", line=1)])

        out = _run_refactor(_params())
        # The good provider's offer still arrives.
        self.assertEqual([o["title"] for o in out["refactorings"]], ["Fine"])

    def test_offers_with_nothing_to_show_are_dropped(self):
        @plugin.refactor("junk")
        def junk(ctx):
            return [
                {"title": "no fixes", "fixes": []},
                {"title": "", "fixes": [fix("f", "x", line=1)]},
                {"fixes": [fix("f", "x", line=1)]},
                {"title": "bad fix shape", "fixes": [{"title": "no edit"}]},
                "not a dict",
                None,
            ]

        self.assertEqual(_run_refactor(_params())["refactorings"], [])

    def test_safe_defaults_to_false_so_an_unproven_rewrite_is_flagged(self):
        @plugin.refactor("p")
        def provider(ctx):
            return refactoring("T", "m", fixes=[fix("f", "x", line=1)])

        self.assertFalse(_run_refactor(_params())["refactorings"][0]["safe"])

    def test_works_with_no_selection_at_all(self):
        @plugin.refactor("p")
        def provider(ctx):
            self.assertIsNone(ctx.selection)
            return []

        self.assertEqual(_run_refactor(_params(selection=None))["refactorings"], [])


class RefactoringBuilderTest(unittest.TestCase):
    def test_omits_an_absent_range_so_the_selection_is_used(self):
        offer = refactoring("T", "m", fixes=[fix("f", "x")])
        for key in ("line", "column", "endLine", "endColumn", "helpArticle"):
            self.assertNotIn(key, offer)

    def test_coerces_its_inputs(self):
        offer = refactoring("T", "m", fixes=[fix("f", "x")], line=3.0, safe=1)
        self.assertEqual(offer["line"], 3)
        self.assertIs(offer["safe"], True)


if __name__ == "__main__":
    unittest.main()
