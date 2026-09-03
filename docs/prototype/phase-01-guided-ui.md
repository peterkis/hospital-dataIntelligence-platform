# Phase 01 guided governance prototype UI

PV-003 builds a browser-operated, synthetic-data governance demonstration on baseline commit `7b11d026752a0bef8631624a358b02267dad6339`. It reuses the existing React Admin Web, frozen Generated API Client, Prototype API, and external PostgreSQL database. It does not create a second frontend or a browser-to-database path.

> 本界面仅用于合成数据下的业务原型演示，不是正式身份认证、安全认证、正式 ABG 或生产就绪证明。

## Start and access

The external PostgreSQL prototype database must already be reachable through the ignored local environment configuration. These commands do not start PostgreSQL, Keycloak, Podman, Docker, a consumer, or a browser.

```powershell
npm run prototype:ui:build
npm run prototype:demo
```

Open [http://127.0.0.1:3000/admin/](http://127.0.0.1:3000/admin/). `prototype:demo` binds only to `127.0.0.1`, prints the URL, and closes the Fastify application and database pool on Ctrl+C.

The default Admin Web build remains formal and writes `apps/admin-web/dist`. The prototype build uses `VITE_ADMIN_MODE=prototype` through Vite prototype mode and writes `apps/admin-web/dist-prototype`; neither build output overwrites the other. An unknown `VITE_ADMIN_MODE` fails with `ADMIN_MODE_INVALID`.

## Prototype authentication

The prototype header mode is `PROTOTYPE_SYNTHETIC`. It is a local, fixed-fixture adapter and is not a security authentication mechanism. The CSRF value returned by `/prototype/context` is only a `NON_SECURITY_MISUSE_GUARD` against accidental local writes.

The browser exposes three fixed Chinese-labelled identities:

| Identity | Responsibility |
| --- | --- |
| 数据维护员 | Creates drafts, submits changes, reads published state, and resolves prices |
| 专业审核员 | Performs the required professional review stage |
| 终审负责人 | Performs final approval and triggers publication |

Technical role codes appear only in expandable technical details. The selected role and journey state are held in React state and `sessionStorage`; no principal UUID is entered by the user. The wrapper around `@hospital-data-intelligence/generated-api-client` injects the current role header on every business request and the prototype CSRF guard on writes. Prototype mode never requests `/auth/session`, `/auth/login`, or `/auth/logout`. The formal bootstrap, Keycloak redirect, browser session, CSRF, and logout path remain unchanged and are still the default build.

## Eight-step journey

1. Create a synthetic charge-item draft with a new unique code, `原型门诊诊查费`, `TIMES`, and `COUNT`.
2. Submit the automatically retained charge-item identity, version, and content digest.
3. Switch explicitly to 数据维护员 and then 专业审核员 as instructed; the professional review cannot be performed by the submitter.
4. Switch explicitly to 终审负责人 for final approval, then to 数据维护员 to read and display the authoritative published version, release identity, and record time.
5. Create `原型院内默认价表` against the published charge-item version with one hospital-wide general entry at `12.34 CNY`.
6. Submit, professionally review, and finally approve the price-list release with the three separated identities, then read the authoritative published release.
7. Resolve quantity `2` through the backend-owned four-level path: campus specific, campus general, hospital specific, and hospital general. The demonstration hits hospital general and returns `24.6800 CNY`.
8. Read the charge-item version history, both approval timelines, published price-list status, resolution result, and current entity/version audit events with their stream sequences and record times.

Governance object IDs, entity IDs, version IDs, change request IDs, release IDs, digests, and price-resolution IDs are automatically stored and transferred. Technical IDs are collapsed by default.

## Time contract

All prototype context, request, response, and displayed platform times use `Asia/Shanghai` local date-time strings in `YYYY-MM-DDTHH:mm:ss[.ffffff]` form. They do not contain `Z` or an offset. The browser does not parse local date-time fields into JavaScript `Date` and does not call `toISOString()`. Price resolution takes `recordAsOf` directly from the published price-list response `recordedFrom`; it is not guessed from process start time.

## Persistence and refresh observation

`prototype:ui:validate` applies the existing 11 native migrations, confirms the idempotent fixture seed, builds the prototype UI, starts the Prototype API, checks health/context/index/assets, runs the existing generated-client HTTP governance smoke, and then confirms persistence growth. The completed browser journey published one new synthetic charge-item version and one new release of the existing synthetic stable price list, and stored a successful `24.6800 CNY` resolution.

Refreshing `/admin/` restored the current identity, step 8, business identifiers, digests, published record times, resolution result, and history/audit display from `sessionStorage`. “重新开始演示” removes only `hdi.prototype.journey.v1`, creates a new synthetic charge-item code, and does not delete PostgreSQL history.

## Validation and limits

The following prototype observations passed on 2026-09-03:

- formal Admin Web build and independent prototype Admin Web build;
- Admin Web prototype state/API unit tests and Prototype API context/lifecycle tests;
- external PostgreSQL connectivity, migration authority, idempotent seed, HTTP governance flow, publication persistence, price resolution, and actual Catalog forbidden-time-zone-type count of zero;
- Prototype UI context/index/JS/CSS availability, absence of formal-auth requests in the prototype bundle, graceful API stop, database-pool close confirmation, and port 3000 release;
- manual in-app browser journey, explicit three-role switching, technical-details disclosure, sticky non-production banner, four-level resolution explanation, and refresh recovery.

This work did not run AR-07, formal verification, formal ABG, Sequence 10–13, Keycloak, Podman, Docker, a formal Playwright suite, production deployment, deployment-environment certification, real identities, real hospital data, or real consumer integration. It does not change the frozen formal OpenAPI or Generated Client Schema.
