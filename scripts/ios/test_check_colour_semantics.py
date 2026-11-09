"""Controls for scripts/ios/check_colour_semantics.py (U-09: mint means observed data)."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location(
    "check_colour_semantics", pathlib.Path(__file__).with_name("check_colour_semantics.py")
)
semantics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(semantics)


class MintDetection(unittest.TestCase):
    def test_counts_every_mint_token_and_role(self):
        text = """
        .foregroundStyle(TapsoColor.mintDeep)
        .background(TapsoColor.journeyActive.opacity(0.1))
        case .data(.live): TapsoColor.dataLive
        RouteBadge(number: n, role: confirmed ? .journeyActive : .journeyChecking)
        RouteBadge(number: n, role: .journeyActive)
        var role: RideColorRole = .journeyActive
        """
        # `confirmed ? .journeyActive` is not a role: or ?? position; the ternary arm is
        # caught by the explicit `role: .journeyActive` form and the token forms only.
        self.assertEqual(semantics.mint_count(text), 5)

    def test_neutral_tokens_are_not_mint(self):
        self.assertEqual(semantics.mint_count("TapsoColor.decorative TapsoColor.decorativeFill TapsoColor.textPrimary"), 0)


class NeutralSurfaces(unittest.TestCase):
    def test_slice_stops_at_the_end_marker(self):
        text = "struct LiveBadge {\n  a\n}\nstruct Other {\n  TapsoColor.mintDeep\n}\n"
        part = semantics.surface_text(text, "struct LiveBadge", "\n}\n")
        self.assertNotIn("mintDeep", part)

    def test_mint_on_a_neutral_surface_fails(self):
        files = {rel: "" for rel, *_ in semantics.NEUTRAL_SURFACES}
        files["apps/ios/TapsoApp/HomeView.swift"] = "Image(systemName: \"map\").foregroundStyle(TapsoColor.mintDeep)"
        files["apps/ios/TapsoApp/LiveRideSetupViews.swift"] = "struct LiveBadge {\n}\nstruct LiveRideEntryCard {\n}\n"
        files["apps/ios/TapsoApp/RideView.swift"] = "if snapshot.resumed {\n            }\n"
        files["apps/ios/TapsoApp/RideEndView.swift"] = "case .comfortable: TapsoColor.decorative\n"
        errors = semantics.neutral_surface_errors(files)
        self.assertEqual(len(errors), 1)
        self.assertIn("HomeView.swift", errors[0])

    def test_a_missing_marker_is_reported_not_skipped(self):
        files = {rel: "" for rel, *_ in semantics.NEUTRAL_SURFACES}
        errors = semantics.neutral_surface_errors(files)
        self.assertTrue(any("not found" in e for e in errors))


class Allowance(unittest.TestCase):
    def test_new_unjustified_mint_fails(self):
        errors = semantics.allowance_errors({"a.swift": "TapsoColor.mintDeep"}, {})
        self.assertEqual(len(errors), 1)
        self.assertIn("0 allowed", errors[0])

    def test_removed_mint_must_lower_the_count(self):
        errors = semantics.allowance_errors({"a.swift": ""}, {"a.swift": (1, "why")})
        self.assertIn("lower the count", errors[0])

    def test_exact_count_passes(self):
        self.assertEqual(semantics.allowance_errors({"a.swift": "TapsoColor.dataLive"}, {"a.swift": (1, "why")}), [])


class CurrentTree(unittest.TestCase):
    def test_the_app_follows_the_rule(self):
        files = semantics.product_swift_files()
        errors = semantics.neutral_surface_errors(files) + semantics.allowance_errors(files, semantics.ALLOWED)
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
