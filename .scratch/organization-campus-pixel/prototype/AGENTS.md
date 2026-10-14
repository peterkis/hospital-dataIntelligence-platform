# Prototype Instructions

## This prototype

- Reference: `C:/Users/zqpet/Downloads/HDIP-MVP-Notion原型完整包 (1)/01-组织与院区.png`, desktop viewport 1440 × 1000.
- User decision: use current vocabulary “部门与服务单元”. Keep the workspace shell from the original reference.
- Flow styling follows the user's ReUI reference: `https://reui.io/blocks/application/flow` and `evidence/reui-flow-reference.png`. Use compact cards with an icon, name/code header, divided type/status footer, small side ports, thin orthogonal dashed connectors, and lightly tinted badges. This overrides the original screenshot's flow styling only.
- Status colors retain hospital meanings: running is teal, planning/drafts are amber, example registration is neutral, and operating-relation labels are blue. Keep status text, relation types and periods explicit.
- This is a separate interactive frontend with fictitious data. Edits live in React state and reset on refresh. No production APIs, authentication, database, or approval workflows.
- Use shadcn/ui and React Flow. Preserve the restrained Notion workspace, source date 2026-10-11, object identities and relationship periods.
- Keep changes inside `.scratch/organization-campus-pixel/`; preserve all pre-existing uncommitted work.
- Before handing off a visual change, compare the reference and rendered default state at 1440 × 1000, then update `design-qa.md` with screenshot evidence and any remaining differences. Hand off only after P0–P2 issues are resolved.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
