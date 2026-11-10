# ExecPlan: Figma marketing hero sync and Pretendard normalization

## 1. User-visible outcome and non-goals

### Outcome

- Make the deployed TAPSO marketing homepage's first viewport track the Figma marketing hero at node `4:2` in `kkx04GvqOzHje7Dw5ikO9X`.
- Keep the existing feature, Dynamic Island demo, matching explanation, waitlist, and footer sections intact below the hero.
- Use Pretendard as the Korean/product UI typeface on the web and align the corresponding Figma text nodes to a shared Pretendard font-family token.
- Preserve the product principle that TAPSO tracks the vehicle and does not make continuous passenger GPS the default.

### Non-goals

- Redesign the full long-form marketing page in this change.
- Change waitlist behavior or data handling.
- Change transit, matching, API, iOS, or Live Activity behavior.
- Introduce a new component framework or Tailwind.

## 2. Verified constraints and assumptions

- VERIFIED: `apps/web` is a React 19 + Vite + TypeScript marketing app.
- VERIFIED: the Figma source frame is `TAPSO / Marketing Hero / Desktop`, node `4:2`, 1440x900.
- VERIFIED: Figma v0.2 now exposes `font/family/korean = Pretendard`, `jeju/basalt`, and `radius/island` variables with web code syntax.
- VERIFIED: the existing web CSS already exposes the core Figma color token names such as `--ink`, `--mint`, `--muted`, and `--tangerine`.
- VERIFIED: the Pretendard project documents the jsDelivr v1.3.9 variable dynamic subset stylesheet used by this implementation.
- ASSUMPTION: loading Pretendard from jsDelivr is acceptable for the public marketing page. If self-hosting becomes a requirement, vendor the WOFF2 assets in a separate change.
- REALITY LABEL: Figma MCP cannot directly load the local Pretendard font in its runtime, so the normalization is implemented through a Figma STRING variable bound to `fontFamily`. The design resolves to Pretendard and remains editable in normal Figma environments where the font is available.

## 3. Milestones and observable completion criteria

1. Figma source cleanup
   - Page renamed to `00 Marketing / Desktop`.
   - Hero frame renamed to `TAPSO / Marketing Hero / Desktop`.
   - Previously Noto Sans KR labels bind to the shared Pretendard font-family variable.
   - Dynamic Island and Dori raw values are tokenized where practical.
2. Web hero alignment
   - Header, hero copy, Dynamic Island capsule, Dori illustration, and sync note mirror the Figma desktop geometry at 1440x900.
   - DOM nodes carry `data-figma-node-id` markers for design-to-code traceability.
3. Typography normalization
   - Pretendard Variable is loaded explicitly.
   - Body, form controls, and hero-specific UI inherit the same product font stack.
4. Verification
   - GitHub Actions `web` job runs `npm ci` and `npm run build` on the pull request.
   - Review PR diff for accidental changes outside the marketing surface.

## 4. Decisions and alternatives considered

- Chosen: create `figma-sync.css` as a small override layer imported after the existing marketing stylesheet. This keeps the Figma-specific hero changes reviewable without rewriting the large existing stylesheet.
- Chosen: keep the long-form sections below the first viewport instead of deleting marketing content simply to mimic a design-system cover frame.
- Chosen: use CSS shapes for the Figma Dori hero illustration because the Figma reference itself is geometric and does not require an image asset.
- Chosen: use the official Pretendard variable dynamic subset CDN stylesheet for predictable Korean typography.
- Rejected: paste Figma-generated Tailwind reference code. The project does not use Tailwind and the repository instructions require adapting to the existing stack.
- Rejected: replace the entire marketing page with the 900px Figma cover. That would remove useful product explanation and the waitlist.

## 5. Reproduction commands and evidence

From repository root:

```bash
npm --prefix apps/web ci
npm --prefix apps/web run build
```

Desktop comparison target:

- Viewport: 1440x900
- Figma file: `kkx04GvqOzHje7Dw5ikO9X`
- Figma node: `4:2`

Key DOM-to-Figma markers:

- Marketing hero frame: `data-figma-node-id="4:2"`
- Header: `4:3`
- Brand: `4:4`
- Hero copy: `4:7` through `4:9`
- Dynamic Island: `4:10` through `4:12`
- Dori: `4:13` through `4:16`
- Sync note: `4:17`

## 6. Progress, unexpected findings, risks, and exact next action

### Progress

- Figma source cleanup: complete.
- Web implementation: prepared on `design/figma-marketing-sync-pretendard`.
- Pretendard web loading: prepared.
- PR verification: pending GitHub Actions after the commit is pushed and PR is opened.

### Unexpected findings

- The Figma file contained a single 1440x900 marketing cover rather than a complete long-form landing-page spec.
- Several visible Figma labels used Noto Sans KR while the main hero copy already used Pretendard.
- The MCP runtime could not load Pretendard directly, but Figma font-family variable binding successfully resolves those labels to Pretendard without flattening text.

### Risks

- CDN failure would fall back to local/system fonts. The stack still names Pretendard first, but exact rendering depends on the webfont request succeeding.
- The desktop hero is intentionally tight to the Figma 1440x900 composition. Responsive breakpoints switch to a stacked layout rather than preserving exact absolute coordinates on small screens.

### Exact next action

Open the pull request, inspect the generated diff, then use the GitHub Actions result as the build gate before merge.
