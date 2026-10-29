# TAPSO web editing workflow

## Sources
- Live: https://tapso-nu.vercel.app/
- Figma: https://www.figma.com/design/kkx04GvqOzHje7Dw5ikO9X?node-id=314-12
- Settings: apps/web/src/design/marketing.json
- Hero: apps/web/src/sections/Hero.tsx
- Presentation: apps/web/src/styles/coast.css (hero), apps/web/src/styles/theme.css (light/dark, header)
- Media and licences: apps/web/src/content/media.ts, docs/product/WEB_MEDIA_SOURCES.md

The Figma `11 Marketing Web` page now contains **Web PR / Editable settings** and the **Web PR / Coast film hero** board, with Light/Dark previews bound to the **TAPSO Web PR** variable collection. Existing iOS and web boards remain intact.

## Edit and publish
1. In Figma Variables open TAPSO Web PR. Change `copy/headline`, `copy/description`, `copy/cta`, and `color/*` in Light/Dark modes. Copy uses Light as canonical for both website themes. Edit variables, rather than detaching or overriding the bound preview text.
2. In the Figma desktop app: Plugins → Development → Import plugin from manifest; select `tools/figma-marketing/manifest.json` from a checkout of this repository. Run **TAPSO · Export website settings**. It reads only this named collection, uses no network or credentials, and downloads marketing.json.
3. In the checkout, create a topic branch and run `npm --prefix apps/web run design:import -- /absolute/path/to/downloaded/marketing.json`. Invalid versions, colors, empty copy and insufficient text contrast are rejected before writing.
4. Run `npm --prefix apps/web test`, `npm --prefix apps/web run typecheck:vercel`, and `npm --prefix apps/web run build`. Review the diff and push a PR. Vercel's existing Git integration creates the preview. Merge only after green CI; the production branch then deploys to the existing domain.

This is an explicit, reviewable export/import workflow, not automatic Figma-to-production synchronization. Current Figma account does not support Code Layers. Figma arbitrary layout edits are not translated into React automatically; request implementation against a node link for layout changes. The local exporter must be installed by the user in their Figma desktop app; no claim of installation or an end-to-end user export is made.

## Runtime
Theme follows the OS initially and persists a manual choice locally; `index.html` applies it before the first paint. The hero plays a muted, looping clip of real drone footage of Joham Coastal Road, Jeju (Pixabay, licence in WEB_MEDIA_SOURCES.md), credited on the page as not being a TAPSO ride. Scrolling cuts it down to an iPhone Lock Screen with TAPSO's Live Activity drawn on synthetic data and labelled as a preview. Reduced motion, data saver and 2G keep a still image; the visitor can pause or play at any time; a failed load keeps the still. Existing waitlist and support endpoints are retained.
