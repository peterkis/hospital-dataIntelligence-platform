SELECT pg_advisory_xact_lock(901002);

-- Historical reads include this stable identity, so it must be frozen too.
CREATE TRIGGER hierarchy_view_immutable
  BEFORE UPDATE OR DELETE ON department_master.hierarchy_view
  FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();
