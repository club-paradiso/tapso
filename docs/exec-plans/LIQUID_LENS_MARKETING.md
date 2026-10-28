# Liquid lens marketing and Figma authoring

## Outcome
Use the observed Genie hero mechanism (blurred scene outside a refractive sphere, pointer response) with TAPSO's own Jeju imagery. Light styling follows selected concept 1, dark follows concept 2. Preserve waitlist, support, product reality labels and existing journey interactions. No copied Google assets.

## Verified
- Connected user Chrome shows Genie hero's central refractive sphere on a blurred moving background; pointer changes its appearance.
- Figma existing file kkx04GvqOzHje7Dw5ikO9X contains marketing and shared tokens. Current plan has no Code Layers; editable Design and an explicit export/import path are required. Figma is not inherently a live CMS.
- Existing web is React/Vite, prerendered, hosted on Vercel. Topic branch and green CI required by AGENTS.md.

## Milestones
1. Implement shader with static fallback, reduced motion, theme choice and journey controls.
2. Add editable Figma copy/token board, export plugin and validated importer; retain existing API behavior.
3. Build/test, inspect desktop/mobile, publish branch and PR. Record deployment status accurately.

## Validation
npm --prefix apps/web test
npm --prefix apps/web run typecheck:vercel
npm --prefix apps/web run build

## Progress
Reference observed; source and existing Figma file located. Implementation in progress.
