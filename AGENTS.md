# TAPSO Engineering Guide

TAPSO (탑서) is an iPhone-first Jeju bus companion. A rider starts a trip, TAPSO matches the physical bus, tracks that vehicle, and keeps stop progress visible through a Live Activity.

## Non-negotiable principles

- Build the primary client with native Swift, SwiftUI, ActivityKit, and WidgetKit.
- Track the transit vehicle; never make continuous passenger GPS the default.
- Keep transit, matching, freshness, and journey logic independent of SwiftUI.
- Treat the Vehicle Matching Engine and Live Activity as core product systems.
- Use official primary sources for Apple and public-transit APIs. Never invent endpoints, fields, limits, or platform behavior.
- Keep credentials server-side and out of Git. Synthetic fixtures must be labeled synthetic.
- Require deterministic tests for transit progress, matching ambiguity, stale data, and journey transitions.
- Keep documentation aligned with behavior and reality labels.
- Use an ExecPlan following `.agent/PLANS.md` for complex work.
- Never push directly to `main`. Work on a topic branch, open a pull request, and require green CI before merging. The CI `main-history-policy` job is a detection guardrail until repository branch protection can be enabled by an administrator.

## Verification

```bash
swift test --package-path packages/transit-core
npm --prefix services/api test
npm --prefix apps/web test
npm --prefix apps/web run typecheck:vercel
npm --prefix apps/web run build
xcodegen generate --spec apps/ios/project.yml --project apps/ios
xcodebuild -project apps/ios/Tapso.xcodeproj -scheme Tapso \
  -destination 'platform=iOS Simulator,name=iPhone 17' build test
```

Run relevant tests and builds before claiming completion. Review `git diff`, look for secrets, and resolve easy warnings or failures before handing off.
