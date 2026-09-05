# Agent instructions

## Agent skills

### Issue tracker

Issues and specifications are tracked as local Markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the canonical `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` states. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. Read the root `CONTEXT.md` and the relevant ADRs under `docs/adr/` before changing domain behavior. See `docs/agents/domain.md`.

### Prototype PostgreSQL

Before local development or tests that connect to the prototype database, use `npm run prototype:db:with -- <npm-script>` and follow `docs/agents/prototype-database.md`. Enter manual database diagnostics only when that wrapper fails. Formal acceptance and capacity runs use their own authoritative runners.
