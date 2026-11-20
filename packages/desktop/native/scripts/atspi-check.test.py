#!/usr/bin/env python3
"""The pure parts of atspi-check.py: which action it invokes and how --action is read. They need no
AT-SPI, so pyatspi is stood in for. Run: python3 native/scripts/atspi-check.test.py"""
import importlib.util
import os
import sys
import types
import unittest

sys.modules.setdefault("pyatspi", types.SimpleNamespace(RELATION_LABELLED_BY=0, RELATION_DESCRIBED_BY=1))
spec = importlib.util.spec_from_file_location("atspi_check", os.path.join(os.path.dirname(os.path.abspath(__file__)), "atspi-check.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class PickAction(unittest.TestCase):
    def test_default_prefers_the_press(self):
        self.assertEqual(check.pick_action(["custom.a", "accessibility.press"]), 1)

    def test_default_falls_back_to_a_native_controls_first_action(self):
        self.assertEqual(check.pick_action(["activate"]), 0)

    def test_default_finds_nothing_without_actions(self):
        self.assertIsNone(check.pick_action([]))

    def test_an_explicit_action_matches_exactly(self):
        names = ["accessibility.press", "custom.mark-read", "custom.mark-read-2"]
        self.assertEqual(check.pick_action(names, "custom.mark-read-2"), 2)
        self.assertEqual(check.pick_action(names, "custom.mark-read"), 1)
        self.assertIsNone(check.pick_action(names, "custom.mark read"))

    def test_an_explicit_action_never_falls_back(self):
        self.assertIsNone(check.pick_action(["activate"], "accessibility.press"))


class ParseActionArgument(unittest.TestCase):
    def test_splits_at_the_last_equals(self):
        self.assertEqual(check.parse_action_argument("Row=mark-read"), ("Row", "mark-read"))
        self.assertEqual(check.parse_action_argument("a=b=c"), ("a=b", "c"))

    def test_needs_both_halves(self):
        for value in ("Row", "=x", "Row="):
            with self.assertRaises(ValueError):
                check.parse_action_argument(value)


if __name__ == "__main__":
    unittest.main()
