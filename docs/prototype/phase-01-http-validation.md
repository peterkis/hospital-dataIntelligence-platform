# Phase 01 external PostgreSQL HTTP API prototype validation

## Scope statement

This work is a synthetic-identity HTTP/API prototype validation only. It is not formal identity authentication, production security validation, formal ABG, production deployment, or production-readiness evidence. The prototype mode must not be used on a hospital intranet production system.

The implementation baseline is `905614ebf38fe74fdf66461c34535d6b0639f761`. The target database is the same external PostgreSQL instance used by PV-001 in the `Anolis-8.9-HDI-POC` WSL2 virtual machine. Its address, username, password, and complete `DATABASE_URL` are intentionally omitted.

## Prototype runtime boundary

| Boundary | Prototype behavior |
|---|---|
| Entry point | `apps/governance-api/src/prototype-main.ts` |
| Default listen address | `127.0.0.1:3000` |
| Required mode | `PROTOTYPE_MODE=true` and `NODE_ENV!=production` |
| Remote binding | Forbidden. The prototype entry point accepts only `127.0.0.1`; there is no approval escape hatch. |
| Authentication mode | `authenticationMode=PROTOTYPE_SYNTHETIC` |
| Principal selection | `x-prototype-principal-code` maps only `prototype-owner`, `prototype-reviewer`, and `prototype-final-owner` to the fixed PV-001 database principals |
| Prototype CSRF | Every write requires the fixed, non-sensitive prototype CSRF guard value in `x-csrf-token`; it prevents accidental calls and is not a production security mechanism |
| Database readiness | Connection, all native SQL migrations, the fixed synthetic campus and governance objects, three principals, and 13 permission grants are verified before listen |
| Notifications | Publication and Outbox records remain transactional; the prototype notification transport only logs that notification was skipped, and no dispatcher or consumer starts |
| Formal runtime | The production `main.ts`, Keycloak authentication adapter, session/CSRF implementation, HTTP notification transport, and release-distribution dispatcher are unchanged |
| Local connection configuration | `.env.prototype.local` is gitignored; it contains the loopback URL and dedicated randomly generated test credential and is never printed or committed |

`prototype:api:start` does not start Keycloak, PostgreSQL, Podman, Docker, Chrome, Playwright, or any consumer. It only connects to an already available external PostgreSQL instance.

## HTTP flow

`tooling/prototype/run-http-flow.ts` uses the existing generated API client and performs real HTTP requests in this order:

1. Health check.
2. Create and read a synthetic charge-item draft.
3. Update the charge-item draft.
4. Submit its change request.
5. Perform professional review.
6. Perform final Owner approval and query the published charge item.
7. Create and submit a synthetic price-list draft.
8. Perform professional review.
9. Perform final Owner approval and query the published price list.
10. Resolve a price for quantity `2` at fixed unit price `12.34 CNY`.
11. Query charge-item version history.
12. Query the corresponding price-resolution audit event.

The independently specified synthetic expected resolution is `24.6800 CNY`. The runner fails immediately unless the response is `SUCCEEDED`, the amount is exactly `24.6800`, and the currency is `CNY`.

`Asia/Shanghai` is the only business-time meaning. All API and domain `LocalDateTime` values remain offset-free strings, PostgreSQL business fields use date/time types without time zone, and JavaScript `Date` is only a temporary current-time source that is explicitly formatted before crossing a boundary. Price resolution uses the published price-list response's `recordedFrom` as `recordAsOf`, so a workflow taking longer than eight seconds cannot query before its own publication record time.

## Rejection scenarios

The same HTTP run must observe all of these failures before it can report `PASSED`:

- A protected query without `x-prototype-principal-code` returns `401`.
- `prototype-owner` attempting the professional-review action returns `403`; the correctly authorized `prototype-reviewer` must perform that stage.
- A write with an incorrect prototype CSRF value returns `403` before any domain write.

Unknown principal codes and missing prototype CSRF values are also covered by the prototype authentication adapter tests.

## Persistence and cleanup contract

All business mutations use the existing HTTP routes, transaction runner, workflow application, and domain modules. The smoke runner never imports a domain module and never reads or writes PostgreSQL directly. Published charge-item and price-list state, price-resolution evidence, history, audit, release snapshots, and Outbox facts are queried through the API after their writes.

`prototype:http:validate` checks the database, applies native SQL migrations, runs the idempotent PV-001 synthetic seed, starts the API, waits for `/health`, runs the HTTP flow, sends `SIGTERM`, waits for graceful exit, and verifies that the configured port is released. The failure path performs the same targeted child-process cleanup. It never starts a dispatcher or consumer.

## Current validation record

| Observation | Result |
|---|---|
| PostgreSQL target | PostgreSQL 18.6 in `Anolis-8.9-HDI-POC`, exposed only for this development validation through Windows loopback port 55434 |
| Dedicated database identity | `hdi_prototype` role and database; password rotated to a new random local test value and omitted from all output |
| Migration state | PASSED, 11/11 native SQL migrations present |
| Synthetic seed | PASSED and idempotent; 3 principals, 1 campus, 2 governance objects, and 13 required permission grants present |
| TypeScript typecheck | PASSED on 2026-09-03 |
| Workspace build | PASSED on 2026-09-03 |
| Prototype authentication and Fastify contract tests | PASSED, 2 files / 14 tests on 2026-09-03 |
| `prototype:validate` | PASSED on 2026-09-03 |
| `prototype:http:validate` | PASSED on 2026-09-03 |
| HTTP API | Started on `127.0.0.1:3000` with `authenticationMode=PROTOTYPE_SYNTHETIC`; no Keycloak or notification consumer started |
| Charge-item HTTP flow | Create, read, update, submit, professional review, final Owner approval, publication query, and history query all PASSED |
| Price-list HTTP flow | Create, submit, professional review, final Owner approval, and publication query all PASSED |
| Price resolution | `SUCCEEDED`; quantity `2.000000` at unit price `12.34`, final amount `24.6800 CNY`; hospital general price selected after the fixed two-level search |
| Rejection scenarios | Missing prototype principal returned 401; wrong-role professional approval returned 403; incorrect prototype CSRF returned 403 |
| Audit query | PASSED; the price-resolution audit event was returned through the generated API client |
| PostgreSQL persistence | PASSED; after API shutdown the published HTTP charge-item count, published HTTP price-list count, and HTTP price-resolution count each increased |
| Cleanup | PASSED; IPC shutdown completed, API child exited, Kysely pools closed, port 3000 released, and no consumer process started |

## Development findings retained

- The first credential-recovery attempt stopped at PostgreSQL `28P01`; no API process started. The dedicated test password was subsequently rotated under explicit authorization and stored only in the gitignored local env file.
- The WSL distribution stops when its last foreground launcher exits on this development machine. Validation therefore kept one explicitly tracked WSL launcher alive for the run and removed it afterward; PostgreSQL itself reported no restart or crash.
- The first HTTP rejection probe returned 500 because the prototype fetch wrapper replaced headers from the generated client's `Request` object. Preserving the original request headers before adding `x-prototype-principal-code` restored the required 403 CSRF response.
- The first complete HTTP flow reached audit query with HTTP 200 but an empty body because the existing audit route omitted `return result`. Returning the already-authorized query result made the generated client observe the audit record.
- Windows `SIGTERM` does not provide a reliable graceful child shutdown seam. The prototype validator now uses an IPC-only shutdown message and retains process termination only as a bounded fallback.
- A failed HTTP final approval left the fixed price-list release as an `AWAITING_FINAL` draft. It was completed through the existing generated-client HTTP approval route; no draft or failure evidence was deleted. Both runners retain the domain-required fixed price-list code. The database runner uses a synthetic base time 30 seconds in the past; the HTTP runner keeps the service occurrence before the flow and takes `recordAsOf` from the just-published price-list response.

## Known unverified scope

- Keycloak login, OIDC/JWT, browser session cookies, and the production CSRF mechanism.
- Notification delivery, dispatcher retries, simulated-consumer processing, and real downstream integrations.
- Formal Phase 01 acceptance, AR-07, formal preflight, ABG sequences, Evidence production/review, and formal Ticket closure.
- Browser behavior, Chrome, Playwright, management UI, production data, real hospital integrations, production security, availability, performance, capacity, backup, disaster recovery, and deployment certification.

No Keycloak, Podman, Docker, Chrome, Playwright, formal ABG, AR-07, or Sequence 10–13 command is part of this prototype validation.

This result remains a synthetic prototype observation, not formal acceptance or production readiness.
