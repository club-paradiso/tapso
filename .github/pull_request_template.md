## Summary

<!-- Briefly describe the change and its intent. Quote relevant design or transit specifications. -->

## Design System V3 & Token Compliance

- [ ] `scripts/design/validate_tokens.py` passes (manifest, Swift tokens, CSS, marketing JSON).
- [ ] WCAG 2.x AA contrast verified for all light/dark pairs (body text ≥ 4.5:1, large text ≥ 3:1).
- [ ] Pretendard preserved in app target only; system fonts (SF Pro Rounded) preserved in Live Activity/Share extensions.
- [ ] No raw hex values introduced outside canonical token declarations.
- [ ] Figma sync manifest (`design/figma-sync-manifest.json`) updated if components or variables change.

## Verification

<!-- Quote exact commands and output. Never claim checks passed without running them. -->

- `python3 scripts/design/validate_tokens.py`
- `python3 scripts/ios/check_localization.py`
- `python3 scripts/ios/check_brand.py`
- `python3 scripts/ios/sync_xcodeproj.py --check`
- `swift test --package-path packages/transit-core`
- `npm --prefix apps/web test`
- `npm --prefix apps/web run build`

## Environment & Reality State
- Verification level: `[ ] VERIFIED_SIMULATOR  [ ] VERIFIED_DEVICE  [ ] IMPLEMENTED  [ ] PROPOSED`
- Physical hardware / APNs blockers preserved: Yes / No
