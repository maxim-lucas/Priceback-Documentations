# PriceBack Documentations

Central documentation hub for all PriceBack projects (app, backend, website, marketing). This repo is the single source of truth for documentation — the `Priceback` (app) and `Priceback-Website` repos link here via their own `CLAUDE.md` and no longer keep a local `docs/` folder.

## Structure

- **`Marketing-Plan/`** — go-to-market strategy, social media, Claude/MCP automation, growth tactics, launch calendar.
- **`Technical/`** — architecture, database design/schema, environment config, build guides, ingestion pipelines, sign-in/paywall configs.
- **`Roadmap/`** — future roadmap, price-drop roadmap, dual-capture plan, Plan A+B rollout, Costco-coupons ingestion roadmap.
- **`Security/`** — security policy and recommendations.
- **`Publishing-Compliance/`** — app store publish checklist/requirements, Play Data Safety answers, reviewer notes.
- **`Operations/`** — task log, common bug fixes, incident response, deployment, audits (credit/performance/subscription-money), technical debt.
- **`Website/`** — website-specific planning (e.g. blog roadmap).

## Conventions

- Every doc lives in exactly one category folder; if none fit, add a new top-level folder here rather than putting docs back in a project repo.
- `Operations/Task_Log.md` and `Operations/Bugs_Common_Fixes.md` are living logs — append to them per the standing rules in the app's memory (read Task_Log before starting any coding task; add a Bugs_Common_Fixes entry after fixing a recurring/production-class bug).
- Cross-repo links: this repo is a sibling directory to `Priceback` and `Priceback-Website` on disk (`../Priceback-Documentations`), and both repos' `CLAUDE.md` instructs Claude to write new documentation here by default, without asking each time.
