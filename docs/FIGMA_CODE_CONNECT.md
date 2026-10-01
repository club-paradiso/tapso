# TAPSO Figma Code Connect

TAPSO uses Figma Code Connect template files (`*.figma.ts`) for the production Web design system.

## Current Figma source

- File: `TAPSO — Product / Marketing Design System`
- File key: `kkx04GvqOzHje7Dw5ikO9X`
- Production page: `11 Marketing Web` (`3:4`, named `03 Web` until 2026-10-01)
- Component families:
  - Button / TAPSO (`88:40`)
  - Text Field / TAPSO (`89:46`)
  - Select Trigger / TAPSO (`90:27`)
  - Dropdown Option / TAPSO (`90:40`)
  - Checkbox / TAPSO (`93:44`)
  - Waitlist Result / TAPSO (`95:29`)
  - Return Banner / TAPSO (`95:42`)
  - Support Amount / TAPSO (`99:17`)
  - Support Dialog / TAPSO (`100:132`)

Journey Card / TAPSO (`97:23`) and Dynamic Island / TAPSO (`98:35`) lost their templates on 2026-09-30: the V1 markup they described was replaced by Marketing Site V2, whose device previews re-draw the iOS Product V2 surfaces (`02F iOS Ride V2`) and are mapped in `docs/product/MARKETING_SITE_V2.md`. The `11 Marketing Web` page holds that mapping in section `165:54`; the V1 frames `9:2` and `10:20` are on `13 Archive`.

The templates live in `apps/web/src/figma/` and are intentionally excluded from `tsconfig.app.json`; they are executed by the Code Connect CLI, not bundled into the production Vite app.

## Validate locally

From `apps/web`:

```bash
npx --yes --package=@figma/code-connect@2.0.0 figma connect parse \
  --config figma.config.json \
  --dry-run
```

CI runs the same parse check after the Web test/build jobs.

## Publish

Code Connect publishing requires a Figma Organization or Enterprise plan plus a Dev or Full seat. Once the Figma file is moved to an eligible plan, create a Figma personal access token with Code Connect write access and file read access, then run:

```bash
export FIGMA_ACCESS_TOKEN="..."
cd apps/web
npx --yes --package=@figma/code-connect@2.0.0 figma connect publish \
  --config figma.config.json \
  --exit-on-unreadable-files
```

Do not commit the token.

## Design/runtime state differences

Some Figma variants visualize internal runtime states rather than React props. In particular, `SupportDialog` owns `loading`, `ready`, `starting`, and `error` in component state; its Figma `Unavailable` variant represents the server configuration where payments are not live. The Code Connect template therefore links the component while documenting the selected design reference state instead of inventing a React `state` prop.

The Web design uses Noto Sans KR only as an editor fallback when Pretendard is unavailable to the Figma runtime. Production CSS remains the typography source of truth and continues to use Pretendard Variable.

## Maintenance

When Web markup or design-system components change:

1. Update the relevant Figma master component rather than detaching screen instances.
2. Keep the matching `*.figma.ts` template synchronized with production JSX/CSS.
3. Run the Code Connect parse check.
4. Publish after review when the Figma plan is eligible.

## iOS Product V2

The iOS V2 components live on page `02F iOS Ride V2` (`152:2`), the V3 components on `02G iOS Product V3` (`212:2`), the finished screens on `03 iOS — GO` (`205:3310`), `04 iOS — RIDE` (`157:10`) and `09 Return / Rescue` (`193:2956`), the Live Activity / Dynamic Island board on `05` (`160:1208`), tokens in the `TAPSO V2 Semantic` collection. Swift Code Connect is not set up (same plan requirement as above); `product/FIGMA_IMPLEMENTATION_MAP_V2.md` maps each node to its SwiftUI view, tokens, journey state, localization keys and accessibility behaviour. SF Pro does not render in this Figma runtime, so iOS frames use Inter (and Noto Sans KR for Korean) as stand-ins; SwiftUI uses the system fonts.
