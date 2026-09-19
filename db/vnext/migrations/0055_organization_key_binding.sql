SELECT pg_advisory_xact_lock(901002);
-- Public fingerprints of random keys, never secret key material. A retained DB
-- remembers initialization even when the entire local secret directory is lost.
CREATE TABLE vnext_control.organization_key_binding (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 payload_fingerprint text NOT NULL CHECK(payload_fingerprint ~ '^[a-f0-9]{64}$'),
 lookup_fingerprint text NOT NULL CHECK(lookup_fingerprint ~ '^[a-f0-9]{64}$')
);
CREATE TRIGGER organization_key_binding_immutable BEFORE UPDATE OR DELETE ON vnext_control.organization_key_binding FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
ALTER TABLE vnext_control.organization_key_binding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vnext_control.organization_key_binding FROM PUBLIC,hdi_prototype;
GRANT SELECT ON vnext_control.organization_key_binding TO hdi_prototype;
