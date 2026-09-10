# Prototype PostgreSQL session

Use this runbook for local Windows development and tests that require the repository's prototype PostgreSQL database. It is a synthetic, non-production convenience path; it is not formal acceptance, capacity evidence, or deployment certification.

## Default path

From the repository root, wrap the target npm script:

```powershell
npm run prototype:db:with -- <npm-script> [script arguments]
```

Examples:

```powershell
npm run prototype:db:with -- prototype:db:migrate
npm run prototype:db:with -- prototype:person:validate
npm run prototype:db:with -- check
```

## Local roles and credentials

The following role facts were verified against the local WSL PostgreSQL catalog on 2026-09-05. Re-query the catalog before an administrative change because local role grants can drift.

| Purpose | PostgreSQL role | LOGIN | CREATEDB | SUPERUSER | Password state |
|---|---|---:|---:|---:|---|
| Application prototype | `hdi_prototype` | Yes | No | No | Stored only through the ignored local environment configuration |
| Local database administration | `postgres` | Yes | Yes | Yes | Not configured; there is no plaintext password to retrieve or document |

The current create-database path uses PostgreSQL peer authentication by entering WSL as the `postgres` operating-system user. With the service held open by the managed session, connect without a password prompt:

```powershell
wsl.exe -d Anolis-8.9-HDI-POC -u postgres -- psql -p 55434 -d postgres
```

Inside that `psql` session, the `postgres` role can run `CREATE DATABASE`. This peer-authenticated local path does not provide password-based access from Windows TCP clients.

Keep every actual password in an ignored local secret store such as `.env.prototype.local`; tracked Markdown contains role capability and secret location only. If password-based `CREATEDB` access is required, obtain separate authorization to provision a dedicated limited administration role, enter its password interactively with `\password`, and store the resulting connection setting only in an ignored local environment file. Do not grant `CREATEDB` to the `hdi_prototype` application role merely to simplify setup.

This password-state query returns booleans but no credential material:

```sql
select rolname, rolcreatedb, rolsuper, rolcanlogin,
       rolpassword is not null as password_configured
from pg_authid
where rolcanlogin and (rolcreatedb or rolsuper)
order by rolname;
```

The wrapper is the first database action in a local development or validation session. It:

1. Requires the ignored `.env.prototype.local` file without reading or printing its values.
2. Checks the fixed `Anolis-8.9-HDI-POC` WSL2 distribution and the `postgresql-18` service.
3. Records whether the target distribution and service were already active, then starts a task-owned WSL keepalive before starting the service. This prevents WSL from stopping between short commands.
4. Polls the safe `prototype:db:check` contract for at most 30 seconds before running the target script.
5. Loads `.env.prototype.local` into the target npm process without placing secrets on its command line.
6. Runs cleanup in `finally`: it stops PostgreSQL only when it owned the service, terminates only its own keepalive process, and terminates the named distribution only when that distribution was stopped before the wrapper began.

Success requires a `DATABASE_SESSION_READY` record, target exit code `0`, and `cleanupPassed: true` in the final `DATABASE_SESSION_CLOSED` record. That final record separates the `systemctl stop` exit code from the observed service/connection outcome, and states whether the runner owned the distribution and service. If the service was already active in an already-running distribution, the wrapper reuses it and leaves it active; do not report database shutdown in that case.

## Failure routing

Treat the wrapper's bounded error code as the diagnostic starting point:

- `PROTOTYPE_DATABASE_ENV_FILE_MISSING`: restore the ignored local environment file through the established secret-management path. Never print, log, diff, or commit its contents.
- `PROTOTYPE_DATABASE_WSL_UNAVAILABLE` or `PROTOTYPE_DATABASE_SERVICE_STATE_UNKNOWN`: verify that the registered distribution and service identity still match this runbook. Do not substitute host PostgreSQL, Docker, or another WSL distribution.
- `ECONNREFUSED` after the wrapper's readiness window: inspect only the fixed service and listener before investigating application code:

  ```powershell
  wsl.exe -d Anolis-8.9-HDI-POC -u root -- systemctl status postgresql-18 --no-pager
  Get-NetTCPConnection -State Listen -LocalPort 55434 -ErrorAction SilentlyContinue
  ```

- Any other database check failure: preserve the safe error code and inspect schema/migration authority. Do not weaken the real-PostgreSQL gate or replace it with mocks.

Do not repeatedly run ad hoc start, check, and keepalive commands before trying the wrapper. A failed initial check followed by a successful wrapped run is infrastructure startup evidence, not an application defect.

## Manual recovery boundary

Manual recovery is exceptional and remains scoped to `Anolis-8.9-HDI-POC`, `postgresql-18`, and loopback port `55434`. Keep the WSL command in a tracked foreground terminal for the whole validation window; a one-shot `systemctl start` is insufficient because WSL may stop after its last foreground client exits.

At completion, close application/database pools first, stop only task-owned database resources, and verify the relevant listener is absent. Retain unrelated WSL distributions, services, processes, and ports.

Formal ABG, formal preflight, and capacity simulations must not use this wrapper. Their frozen environment, exclusivity, evidence, and teardown contracts remain authoritative.
