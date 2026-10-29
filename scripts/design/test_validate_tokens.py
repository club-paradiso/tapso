"""Regression tests: detect CSS drift even when marketing.json is unchanged."""
import json
import pathlib
import unittest

from validate_tokens import check_web_css, css_declarations

ROOT = pathlib.Path(__file__).resolve().parents[2]


class WebTokenParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(
            (ROOT / "design/tokens/tokens.json").read_text(encoding="utf-8")
        )
        cls.tokens_css = (
            ROOT / "apps/web/src/styles/tokens.css"
        ).read_text(encoding="utf-8")
        cls.theme_css = (
            ROOT / "apps/web/src/styles/theme.css"
        ).read_text(encoding="utf-8")

    def check(self, tokens_css=None, theme_css=None):
        return check_web_css(
            self.manifest,
            self.tokens_css if tokens_css is None else tokens_css,
            self.theme_css if theme_css is None else theme_css,
        )

    def test_current_web_css_matches_manifest(self):
        self.assertEqual([], self.check())

    def test_light_theme_color_drift_is_detected(self):
        changed = self.tokens_css.replace("--ink: #0f171a;", "--ink: #123456;", 1)
        self.assertNotEqual(changed, self.tokens_css)
        self.assertTrue(any(":root --ink:" in e for e in self.check(tokens_css=changed)))

    def test_dark_theme_color_drift_is_detected(self):
        changed = self.theme_css.replace("--bg: #0f171a;", "--bg: #123456;", 1)
        self.assertNotEqual(changed, self.theme_css)
        self.assertTrue(any('[data-theme="dark"] --bg:' in e for e in self.check(theme_css=changed)))

    def test_dark_theme_phone_override_drift_is_detected(self):
        changed = self.theme_css.replace(
            "--mint-ink: #097666;", "--mint-ink: #123456;", 1
        )
        self.assertNotEqual(changed, self.theme_css)
        self.assertTrue(any(".phone --mint-ink:" in e for e in self.check(theme_css=changed)))

    def test_missing_css_token_is_detected(self):
        changed = self.tokens_css.replace("--separator: #e1e6e4;", "", 1)
        self.assertNotEqual(changed, self.tokens_css)
        self.assertTrue(any(":root --separator:" in e for e in self.check(tokens_css=changed)))

    def test_scoped_selector_and_comments(self):
        sample = """
        /* :root { --ink: #abcdef; } */
        [data-theme="dark"] .phone, [data-theme="dark"] .island {
          --ink: #0f171a;
        }
        """
        self.assertEqual(
            {"--ink": "#0f171a"},
            css_declarations(sample, '[data-theme="dark"] .phone'),
        )


if __name__ == "__main__":
    unittest.main()
