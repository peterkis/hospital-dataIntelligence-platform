import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import {
  readReceipt,
  inspect,
  checkPrefix,
  migrationFiles,
  resolveTarget,
  peer,
  quote,
  identitySQL,
  root,
} from "./lineage.mjs";
import { saveExclusiveReceipt } from "./receipt.mjs";

const receiptPath = resolve(root, ".runtime/vnext/p0-09/owner-service.json");
const secretPath = resolve(
  root,
  ".runtime/vnext/p0-09/owner-service.secret.json",
);
// Explicit public Owner entry points plus the two internal service attestations.
const functions = [
  "read_catalog",
  "read_effective",
  "history",
  "command",
  "resolve_source",
  "change_impact",
  "impact_cases",
  "contract_read",
  "contract_command",
  "contract_change_impact",
  "contract_impact_cases",
  "parameter_read",
  "parameter_command",
  "import_job_command",
  "import_job_read",
  "protected_command",
  "protected_digest_denial",
  "file_receive_denial",
  "register_parse",
  "read_parse",
  "validation_prior",
  "read_validation",
  "accept_validation",
  "quality_issue_open_prior",
  "quality_issue_ingest",
  "quality_issue_read",
  "quality_issue_detail",
  "quality_issue_assign",
  "quality_correction_prior",
  "quality_issue_record_correction",
  "quality_resolution_prior",
  "quality_issue_resolve",
  "quality_batch_reject",
  "quality_eligibility",
];

export async function ownerServiceConnection() {
  const receipt = readReceipt();
  const observation = await inspect(receipt);
  if (
    checkPrefix(migrationFiles(), observation.ledger) !==
    migrationFiles().length
  )
    throw new Error("CURRENT_LINEAGE_REQUIRED");
  const ownership = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (
    ownership.database !== receipt.name ||
    ownership.databaseOid !== receipt.oid ||
    ownership.databaseRequestId !== receipt.requestId
  )
    throw new Error("OWNER_RECEIPT_MISMATCH");
  const secret = JSON.parse(readFileSync(secretPath, "utf8"));
  const url = new URL(resolveTarget(receipt));
  url.username = ownership.role;
  url.password = secret.password;
  const pool = new pg.Pool({ connectionString: url.href, max: 1 });
  try {
    const row = (
      await pool.query(
        "SELECT current_user AS role,current_database() AS database,d.oid::text AS oid,inet_server_port() AS port,r.oid::text AS role_oid,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,r.rolreplication FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()",
      )
    ).rows[0];
    if (
      row.role !== ownership.role ||
      row.role_oid !== ownership.roleOid ||
      row.database !== receipt.name ||
      row.oid !== receipt.oid ||
      row.port !== receipt.port ||
      row.rolsuper ||
      row.rolcreatedb ||
      row.rolcreaterole ||
      row.rolbypassrls ||
      row.rolreplication
    )
      throw new Error("OWNER_CONNECTION_IDENTITY_MISMATCH");
    const risk = (
      await pool.query(
        "SELECT (SELECT count(*) FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) + (SELECT count(*) FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) + (SELECT count(*) FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS count",
      )
    ).rows[0];
    if (Number(risk.count)) throw new Error("OWNER_PRIVILEGE_BOUNDARY_INVALID");
  } finally {
    await pool.end();
  }
  return url.href;
}

async function provision() {
  const receipt = readReceipt();
  const observation = await inspect(receipt);
  if (checkPrefix(migrationFiles(), observation.ledger) !== 51)
    throw new Error("G0_PREFIX_51_REQUIRED");
  if (existsSync(receiptPath) || existsSync(secretPath))
    throw new Error("OWNER_ALREADY_PROVISIONED");
  const role = "hdi_owner_" + randomUUID().replaceAll("-", "").slice(0, 16);
  const ownership = {
    taskId: "P0-09",
    role,
    database: receipt.name,
    databaseOid: receipt.oid,
    databaseRequestId: receipt.requestId,
  };
  saveExclusiveReceipt(receiptPath + ".intent", ownership);
  peer(receipt.name, identitySQL(receipt));
  peer(
    "postgres",
    `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 8;`,
  );
  const roleOid = peer(
    "postgres",
    `SELECT oid::text FROM pg_roles WHERE rolname=${quote(role)};`,
  );
  saveExclusiveReceipt(receiptPath, {
    ...ownership,
    roleOid,
    functions,
    tableGrants: [],
    schemaOwnership: "UNCHANGED",
    databaseOwnership: "UNCHANGED",
  });
  const password = randomBytes(32).toString("hex");
  writeFileSync(secretPath, JSON.stringify({ password }), {
    flag: "wx",
    mode: 0o600,
  });
  // Windows ACL: credential file is readable only by its current owner and SYSTEM.
  const acl = spawnSync(
    "icacls.exe",
    [
      secretPath,
      "/inheritance:r",
      "/grant:r",
      `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(F)`,
      "SYSTEM:(F)",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (acl.status !== 0) throw new Error("OWNER_SECRET_ACL_FAILED");
  const credential = spawnSync(
    "wsl.exe",
    [
      "-d",
      receipt.distro,
      "-u",
      "postgres",
      "--",
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-p",
      String(receipt.port),
      "-d",
      receipt.name,
      "-At",
    ],
    {
      input: `SET log_statement='none'; SET log_min_error_statement='panic'; SET log_min_duration_statement=-1; SET log_duration=off; ALTER ROLE ${role} LOGIN PASSWORD '${password}';`,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (credential.status !== 0)
    throw new Error("OWNER_CREDENTIAL_PROVISION_FAILED");
  peer(
    receipt.name,
    `${identitySQL(receipt)} GRANT CONNECT ON DATABASE ${receipt.name} TO ${role}; GRANT USAGE ON SCHEMA governance_catalog,vnext_control TO ${role};
 DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='governance_catalog' AND p.proname=ANY(ARRAY[${functions.map(quote).join(",")}]) LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ${role}',f.signature); END LOOP; END $$;`,
  );
  await ownerServiceConnection();
  const boundary = JSON.parse(
    peer(
      receipt.name,
      `SELECT json_build_object('ordinaryAcceptance',has_function_privilege('hdi_prototype','governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)','EXECUTE'),'ordinaryCorrection',has_function_privilege('hdi_prototype','governance_catalog.quality_issue_record_correction(text,jsonb,uuid,uuid)','EXECUTE'),'ordinaryMembership',pg_has_role('hdi_prototype',${quote(role)},'MEMBER'),'trustedAcceptance',has_function_privilege(${quote(role)},'governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)','EXECUTE'));`,
    ),
  );
  if (
    boundary.ordinaryAcceptance ||
    boundary.ordinaryCorrection ||
    boundary.ordinaryMembership ||
    !boundary.trustedAcceptance
  )
    throw new Error("OWNER_PRIVILEGE_BOUNDARY_INVALID");
  saveExclusiveReceipt(receiptPath + ".verified.json", {
    ...ownership,
    roleOid,
    boundary,
    status: "PASS",
  });
  console.log(
    JSON.stringify({
      status: "PASS",
      gate: "G0_OWNER_SERVICE",
      ...boundary,
      receipt: receiptPath,
    }),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  try {
    const command = process.argv.slice(2).join(" ");
    if (command === "--provision") await provision();
    else if (["--activate-summary", "--activate-access"].includes(command)) {
      const functionName =
        command === "--activate-summary"
          ? "import_workbench_summary"
          : "import_workbench_file_access";
      await ownerServiceConnection();
      const receipt = readReceipt();
      const owner = JSON.parse(readFileSync(receiptPath, "utf8"));
      if (!/^hdi_owner_[a-f0-9]{16}$/.test(owner.role))
        throw new Error("OWNER_ROLE_IDENTITY_MISMATCH");
      peer(
        receipt.name,
        `${identitySQL(receipt)} GRANT EXECUTE ON FUNCTION governance_catalog.${functionName}(text,jsonb) TO ${owner.role};`,
      );
      saveExclusiveReceipt(
        receiptPath +
          (command === "--activate-summary" ? ".summary.json" : ".access.json"),
        {
          databaseOid: receipt.oid,
          roleOid: owner.roleOid,
          additionalFunction: `governance_catalog.${functionName}(text,jsonb)`,
          tableGrants: [],
          status: "PASS",
        },
      );
      console.log(
        JSON.stringify({
          status: "PASS",
          gate:
            command === "--activate-summary"
              ? "P0_09_SUMMARY_GRANT"
              : "P0_09_FILE_ACCESS_GRANT",
        }),
      );
    } else throw new Error("CLOSED_COMMAND_REQUIRED");
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "BLOCKED",
        code: /^[A-Z][A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "OWNER_SERVICE_FAILED",
      }),
    );
    process.exitCode = 1;
  }
}
