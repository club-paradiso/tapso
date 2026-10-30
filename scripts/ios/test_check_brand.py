"""Negative controls for scripts/ios/check_brand.py (web wordmark structure)."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("check_brand", pathlib.Path(__file__).with_name("check_brand.py"))
brand = importlib.util.module_from_spec(spec)
spec.loader.exec_module(brand)

HEADER = '''<a className="brand" href="#top" aria-label="TAPSO, 맨 위로">
  <span className="brand-word" data-wordmark="TAPSO" aria-hidden="true">
    TAPS<span className="brand-word-o">O</span>
  </span>
</a>'''
FOOTER = '''<span className="brand-word" role="img" aria-label="TAPSO">
  TAPS<span className="brand-word-o" aria-hidden="true">O</span>
</span>'''
CSS = '''.brand-word-o { position: relative; font: inherit; }
.brand-word-o::after { content: ""; width: 0.54em; background: currentColor; }'''


class WebWordmark(unittest.TestCase):
    def errors(self, text):
        return brand.web_wordmark_errors("Header.tsx", text)

    def test_current_header_and_footer_pass(self):
        self.assertEqual(self.errors(HEADER), [])
        self.assertEqual(self.errors(FOOTER), [])

    def test_precomposed_literal_still_passes(self):
        self.assertEqual(self.errors('<span aria-label="TAPSO">TAPSŌ</span>'), [])

    def test_plain_o_without_the_macron_span_fails(self):
        self.assertTrue(self.errors('<span aria-label="TAPSO">TAPSO</span>'))

    def test_decomposed_macron_fails(self):
        self.assertTrue(self.errors('<span aria-label="TAPSO">TAPSŌ</span>'))
        self.assertTrue(self.errors('<span aria-label="TAPSO">TAPSÖ</span>'))

    def test_split_wordmark_without_accessible_name_fails(self):
        self.assertTrue(self.errors('<span>TAPS<span className="brand-word-o">O</span></span>'))

    def test_korean_suffix_fails(self):
        self.assertTrue(self.errors(HEADER + "<span>탑서</span>"))

    def test_changed_letters_fail(self):
        self.assertTrue(self.errors(HEADER.replace("TAPS<span", "TAP5<span")))


class MacronCss(unittest.TestCase):
    def test_current_css_passes(self):
        self.assertEqual(brand.web_macron_css_errors(CSS), [])

    def test_missing_bar_fails(self):
        self.assertTrue(brand.web_macron_css_errors(".brand-word-o { font: inherit; }"))

    def test_bar_not_in_current_color_fails(self):
        self.assertTrue(brand.web_macron_css_errors(CSS.replace("currentColor", "#000")))

    def test_o_with_its_own_font_fails(self):
        self.assertTrue(brand.web_macron_css_errors(CSS.replace("font: inherit;", "font-family: serif;")))


if __name__ == "__main__":
    unittest.main()
