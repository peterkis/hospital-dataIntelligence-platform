# Phase 01 external PostgreSQL business prototype validation

## Scope statement

This record is only for a database-backed business prototype. It is not formal acceptance, production readiness, or deployment-environment certification.

The prototype uses synthetic data only. It does not start or validate Keycloak, Podman, Docker, Chrome, Playwright, an HTTP server, notification consumers, formal preflight, shared/formal ABG, or AR-07.

## Prototype result

| Observation | Result |
|---|---|
| PostgreSQL address | `Anolis-8.9-HDI-POC` WSL2 VM through a loopback-forwarded non-default port; URL and credentials omitted |
| PostgreSQL version | PostgreSQL 18.6; major version 18 |
| Migration count | 11 |
| First migration run | Exit 0; applied migrations `0001` through `0011` exactly once |
| Second migration run | Exit 0; applied no migrations |
| First synthetic seed run | Exit 0; inserted 3 principals, 1 campus, 2 governance objects, and 13 permission grants |
| Second synthetic seed run | Exit 0; inserted 0 rows in every seed category; `seedIdempotent=true` |
| Core governance flow | Exit 0; charge and price-list draft, submission, professional review, Owner final approval, publication, price resolution, version history, and audit query all passed |
| Price resolution | `SUCCEEDED`; quantity `2.000000` at unit price `12.34`, final amount `24.6800 CNY`; fixed two-level resolution selected the hospital general price |
| Persistence after PostgreSQL service restart | PostgreSQL service MainPID changed and returned active; post-restart validation exited 0, with cumulative published charge versions, published price-list releases, and price resolutions increasing from `1/1/1` to `2/2/2` |

## Final synthetic object IDs

| Object | Before service restart | After service restart |
|---|---|---|
| Charge item | `01a06117-37d1-7c84-91be-24bdbeb13107` | `01a06117-f876-71b7-bc4a-ac0b87a0673b` |
| Charge item version | `01a06117-37d7-77a4-89bd-5a375dbcfad3` | `01a06117-f879-75ac-93ac-1d7922c35b61` |
| Charge governance release | `01a06117-382d-70f7-84c2-5ee3e38c3c36` | `01a06117-f8b0-75c3-a183-1e48fc4444ca` |
| Price list | `01a06117-384b-74a8-a1af-dc7c3e24cfe4` | `01a06117-384b-74a8-a1af-dc7c3e24cfe4` |
| Price-list release | `01a06117-384c-7bde-9389-039ce4ae9f2e` | `01a06117-f8c9-7963-a0ef-453ffb0f4839` |
| Price governance release | `01a06117-389f-713b-b8ba-d44c27e8ce92` | `01a06117-f906-74c4-b571-b25ac05e8a95` |
| Price resolution | `01a06117-38bc-7cfb-ae9a-f4d884eb5de4` | `01a06117-f91a-75f7-bcf5-b140d59b5ae3` |

## Known unverified scope

- Formal Phase 01 acceptance, AR-07, formal preflight, ABG sequences, evidence Manifests, and reviewer output.
- Production readiness, deployment certification, security hardening, availability, performance, capacity, backup, disaster recovery, and production data behavior.
- Keycloak authentication, browser behavior, HTTP routing, notification delivery, and simulated consumers.
- PostgreSQL minor-version conformance and extension governance beyond what the existing migrations enforce.
