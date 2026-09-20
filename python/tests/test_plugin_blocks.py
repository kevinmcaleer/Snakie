"""The ``@plugin.blocks`` provider API (#1017, epic #1007).

The second of the epic's three answers to "what about a library Blockly has
never seen?": a part ships its blocks as a ``blocks.yml``, a plugin returns the
same shape over this host, and the escape hatches (#1018) cover the rest.
Extending the palette never means editing Snakie.

The host deliberately does almost no checking — the blocks are validated on the
Snakie side against exactly the same schema a part's ``blocks.yml`` goes
through, so the warnings come back where somebody will see them. What the host
IS responsible for is the two things nothing downstream can fix: grouping the
blocks by the plugin that registered them (their ids are namespaced per plugin,
so two plugins may both ship a ``beep``), and making sure one broken provider
cannot empty the palette for everybody else.
"""
import unittest

from snakie import block, plugin
from snakie.host import _list_blocks


class BlockBuilderTest(unittest.TestCase):
    def test_builds_the_minimum(self):
        b = block("beep", "beep", "buzzer.beep()\n")
        self.assertEqual(
            b, {"id": "beep", "message": "beep", "code": "buzzer.beep()\n", "shape": "statement"}
        )

    def test_carries_every_optional_field(self):
        b = block(
            "read",
            "distance in cm",
            "{SETUP}.range()",
            args=[{"name": "N", "kind": "number", "default": 1}],
            shape="value",
            output="Number",
            setup={"name": "tof", "expr": "VL53L0X(i2c)"},
            imports=["vl53l0x"],
            tooltip="How far away it is.",
            help="ref-pins",
            level="advanced",
            colour="#d4553f",
            inline=False,
        )
        self.assertEqual(b["shape"], "value")
        self.assertEqual(b["output"], "Number")
        self.assertEqual(b["setup"], {"name": "tof", "expr": "VL53L0X(i2c)"})
        self.assertEqual(b["imports"], ["vl53l0x"])
        self.assertEqual(b["tooltip"], "How far away it is.")
        self.assertEqual(b["help"], "ref-pins")
        self.assertEqual(b["level"], "advanced")
        self.assertEqual(b["colour"], "#d4553f")
        self.assertIs(b["inline"], False)

    def test_a_block_says_nothing_about_its_level_by_default(self):
        # Absent means `simple` on the Snakie side (#1213), so the everyday
        # block a plugin ships stays in the beginner's drawer without saying so.
        self.assertNotIn("level", block("beep", "beep", "buzzer.beep()\n"))

    def test_an_unknown_shape_is_a_statement(self):
        # Statement is the safe default: it stacks, so a mistake shows up as a
        # block in the wrong place rather than one that cannot be used at all.
        self.assertEqual(block("x", "x", "x()", shape="nonsense")["shape"], "statement")

    def test_a_string_setup_is_taken_as_the_expression(self):
        self.assertEqual(block("x", "x", "{SETUP}.go()", setup="Thing()")["setup"], {"expr": "Thing()"})


class BlockProviderRegistryTest(unittest.TestCase):
    def setUp(self):
        # The registry is a module-level singleton shared by every plugin, so
        # each test starts from a clean slate and restores what it found.
        self._saved = list(plugin.block_providers)
        plugin.block_providers.clear()

    def tearDown(self):
        plugin.block_providers[:] = self._saved

    def test_decorator_registers_and_returns_the_function(self):
        @plugin.blocks("classroom")
        def provider():
            return []

        self.assertEqual(len(plugin.block_providers), 1)
        self.assertEqual(plugin.block_providers[0].name, "classroom")
        self.assertIs(plugin.block_providers[0].handler, provider)
        # The decorator must hand the function back unchanged.
        self.assertEqual(provider(), [])

    def test_lists_a_providers_blocks_grouped_by_plugin(self):
        plugin._current_plugin_id = "classroom_kit"

        @plugin.blocks("classroom")
        def provider():
            return [block("cheer", "cheer", 'print("well done!")\n')]

        plugin._current_plugin_id = ""
        result = _list_blocks()
        self.assertEqual(len(result["providers"]), 1)
        group = result["providers"][0]
        self.assertEqual(group["pluginId"], "classroom_kit")
        self.assertEqual(group["name"], "classroom")
        self.assertEqual([b["id"] for b in group["blocks"]], ["cheer"])

    def test_falls_back_to_the_provider_name_when_there_is_no_plugin_id(self):
        # A plugin imported outside the host's discovery loop (a test, a REPL)
        # has no id; the drawer still has to be called something.
        @plugin.blocks("loose")
        def provider():
            return [block("x", "x", "x()")]

        self.assertEqual(_list_blocks()["providers"][0]["pluginId"], "loose")

    def test_accepts_a_single_block(self):
        @plugin.blocks("one")
        def provider():
            return block("x", "x", "x()")

        self.assertEqual(len(_list_blocks()["providers"][0]["blocks"]), 1)

    def test_accepts_a_handler_that_takes_a_context(self):
        # `def f(ctx)` is the obvious mistake — every other handler takes one —
        # and costs nothing to accept.
        @plugin.blocks("ctx")
        def provider(ctx):
            return [block("x", "x", "x()")]

        self.assertEqual(len(_list_blocks()["providers"][0]["blocks"]), 1)

    def test_a_provider_returning_nothing_contributes_no_drawer(self):
        @plugin.blocks("empty")
        def provider():
            return None

        self.assertEqual(_list_blocks()["providers"], [])

    def test_non_dict_entries_are_dropped(self):
        @plugin.blocks("messy")
        def provider():
            return [block("x", "x", "x()"), "not a block", 42]

        self.assertEqual(len(_list_blocks()["providers"][0]["blocks"]), 1)

    def test_a_broken_provider_cannot_empty_the_palette(self):
        @plugin.blocks("broken")
        def broken():
            raise RuntimeError("boom")

        @plugin.blocks("fine")
        def fine():
            return [block("x", "x", "x()")]

        result = _list_blocks()
        self.assertEqual([g["name"] for g in result["providers"]], ["fine"])

    def test_a_broken_context_taking_provider_is_isolated_too(self):
        # The TypeError retry must not swallow a genuine failure in a handler
        # that really does take a context.
        @plugin.blocks("broken-ctx")
        def broken(ctx):
            raise RuntimeError("boom")

        self.assertEqual(_list_blocks()["providers"], [])


class BundledExampleTest(unittest.TestCase):
    """The shipped ``examples/plugins/blocks_demo`` is a scaffold people copy.

    Snakie's own validator is TypeScript, so it cannot run here — but the two
    rules that decide whether a block is usable at all are cheap to restate:
    every ``%n`` in the message has an argument behind it, and every ``{HOLE}``
    in the template names one. A scaffold that silently produced no blocks would
    teach the wrong thing to everybody who copied it.
    """

    def _blocks(self):
        import importlib.util
        from pathlib import Path

        path = Path(__file__).resolve().parents[2] / "examples" / "plugins" / "blocks_demo" / "__init__.py"
        spec = importlib.util.spec_from_file_location("snakie_blocks_demo_fixture", path)
        module = importlib.util.module_from_spec(spec)
        saved = list(plugin.block_providers)
        plugin.block_providers.clear()
        try:
            spec.loader.exec_module(module)
            groups = _list_blocks()["providers"]
        finally:
            plugin.block_providers[:] = saved
        self.assertEqual(len(groups), 1)
        return groups[0]["blocks"]

    def test_every_block_is_well_formed(self):
        import re

        for b in self._blocks():
            args = {a["name"] for a in b.get("args", [])}
            slots = {int(m) for m in re.findall(r"%(\d+)", b["message"])}
            self.assertEqual(
                slots,
                set(range(1, len(args) + 1)),
                f"{b['id']}: message slots do not match its arguments",
            )
            holes = set(re.findall(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", b["code"]))
            if b.get("setup"):
                holes |= set(re.findall(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", b["setup"]["expr"]))
                args.add("SETUP")
            self.assertTrue(
                holes <= args,
                f"{b['id']}: template refers to {holes - args}, which it has no argument for",
            )

    def test_it_demonstrates_each_shape(self):
        # The scaffold earns its place by covering the forms somebody copying it
        # will need: a socket, a dropdown, a value block and a hoisted setup.
        blocks = {b["id"]: b for b in self._blocks()}
        self.assertEqual(blocks["bumped"]["shape"], "value")
        self.assertEqual(blocks["turn"]["args"][0]["kind"], "choice")
        self.assertIn("setup", blocks["say"])


if __name__ == "__main__":
    unittest.main()
