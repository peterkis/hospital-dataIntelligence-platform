# Domain documentation

This repository uses a single domain context.

Before changing behavior, agents must read the root `CONTEXT.md`, the Phase 01 plan when relevant, and every ADR that governs the affected capability. Project terminology must follow `CONTEXT.md`; explicitly avoided synonyms must not be reintroduced in APIs, schemas, tests, specifications, or user-facing text.

System-wide architectural and domain decisions live under `docs/adr/`. A specification or implementation that conflicts with an accepted ADR must identify the conflict and obtain a new or superseding ADR rather than silently changing the rule.
