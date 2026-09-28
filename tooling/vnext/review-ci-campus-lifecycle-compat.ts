type Peer = (database: string, sql: string) => string;
type Receipt = {name: string};

// Historical upgrade regressions deliberately execute the current TypeScript
// Owners against an older, frozen migration prefix. Keep their release view
// pinned to the migration that each scenario is proving; normal/fresh runs see
// the complete tracked migration set.
export function historicalWorkspaceBoundary(env: NodeJS.ProcessEnv = process.env): number | null {
 if (env['HDIP_REVIEW_CI_UPGRADE'] === '1') return 72;
 if (env['HDIP_REVIEW_CI_LICENSE_UPGRADE'] === '1') return 73;
 if (env['HDIP_REVIEW_CI_ENDPOINT_UPGRADE'] === '1') return 74;
 if (env['HDIP_REVIEW_CI_PREVIOUS_UPGRADE'] === '1') return 77;
 if (env['HDIP_REVIEW_CI_MANIFEST_UPGRADE'] === '1') return 77;
 return null;
}

// P1-07 introduced campus_admission in migration 0079. Older migration
// snapshots predate retirement/resumption semantics, but the current Operating
// Owner calls the function before planning. Install a no-op only inside the
// isolated GitHub synthetic database so historical P1-06 evidence can continue
// to exercise its original authorization boundary. Current/fresh runs never
// receive this compatibility function and therefore exercise the real 0079 SQL.
export function installHistoricalCampusAdmission(
 peer: Peer,
 receipt: Receipt,
 env: NodeJS.ProcessEnv = process.env,
): void {
 if (historicalWorkspaceBoundary(env) === null) return;
 const connection = env['VNEXT_VALIDATION_OWNER_URL'];
 if (!connection) throw new Error('REVIEW_CI_CONNECTION_REQUIRED');
 const role = new URL(connection).username;
 if (!/^hdi_validation_[0-9a-f]{16}$/.test(role)) throw new Error('REVIEW_CI_ROLE_REQUIRED');
 peer(receipt.name, `
DO $compat$
BEGIN
 IF pg_catalog.to_regprocedure('organization_master.campus_admission(text,uuid,timestamp without time zone,timestamp without time zone)') IS NOT NULL THEN
  RAISE EXCEPTION 'REVIEW_CI_CAMPUS_ADMISSION_ALREADY_PRESENT';
 END IF;
 CREATE FUNCTION organization_master.campus_admission(
  p_actor text,
  p_campus uuid,
  p_from timestamp without time zone,
  p_to timestamp without time zone
 ) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path=pg_catalog
 AS $body$
 BEGIN
  RETURN;
 END
 $body$;
END
$compat$;
ALTER FUNCTION organization_master.campus_admission(text,uuid,timestamp without time zone,timestamp without time zone) OWNER TO hdi_prototype;
REVOKE ALL ON FUNCTION organization_master.campus_admission(text,uuid,timestamp without time zone,timestamp without time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION organization_master.campus_admission(text,uuid,timestamp without time zone,timestamp without time zone) TO "${role}";
`);
}
