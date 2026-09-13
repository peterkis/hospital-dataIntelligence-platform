-- Preserve immutable event IDs/FKs and historical tokens. The new canonical
-- sequence is allocated within each contract; old gaps remain valid history.
SELECT pg_advisory_xact_lock(901002);
ALTER TABLE governance_catalog.import_contract_event ADD COLUMN stream_sequence bigint;
ALTER TABLE governance_catalog.import_contract_event DISABLE TRIGGER import_contract_event_immutable;
UPDATE governance_catalog.import_contract_event SET stream_sequence=head;
ALTER TABLE governance_catalog.import_contract_event ENABLE TRIGGER import_contract_event_immutable;
ALTER TABLE governance_catalog.import_contract_event ALTER COLUMN stream_sequence SET NOT NULL;
ALTER TABLE governance_catalog.import_contract_event ADD CONSTRAINT contract_stream_sequence_unique UNIQUE(contract_id,stream_sequence);
ALTER TABLE governance_catalog.import_contract_event ADD CONSTRAINT contract_stream_sequence_positive CHECK(stream_sequence>0);
CREATE FUNCTION governance_catalog.allocate_contract_sequence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF NEW.stream_sequence IS NOT NULL THEN RAISE EXCEPTION 'SERVER_SEQUENCE_REQUIRED'; END IF;
 SELECT coalesce(max(stream_sequence),0)+1 INTO NEW.stream_sequence FROM governance_catalog.import_contract_event WHERE contract_id=NEW.contract_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION governance_catalog.allocate_contract_sequence() FROM PUBLIC,hdi_prototype;
CREATE TRIGGER allocate_contract_sequence BEFORE INSERT ON governance_catalog.import_contract_event FOR EACH ROW EXECUTE FUNCTION governance_catalog.allocate_contract_sequence();

DO $stream_consumers$
DECLARE definition text; routine text;
BEGIN
 definition:=pg_get_functiondef('governance_catalog.contract_command(text,jsonb)'::regprocedure);
 IF position('ev.head::text' IN definition)=0 THEN RAISE EXCEPTION 'CONTRACT_COMMAND_VERSION_MISMATCH'; END IF;
 definition:=replace(replace(definition,'ev.head::text','ev.stream_sequence::text'),'ORDER BY head DESC','ORDER BY stream_sequence DESC');
 EXECUTE definition;

 definition:=pg_get_functiondef('governance_catalog.contract_read(text,jsonb)'::regprocedure);
 IF position('o.code,e.head,e.status' IN definition)=0 THEN RAISE EXCEPTION 'CONTRACT_READ_VERSION_MISMATCH'; END IF;
 definition:=replace(definition,'o.code,e.head,e.status','o.code,e.stream_sequence AS head,e.status');
 definition:=replace(definition,'e.head=(SELECT max(current_event.head)','e.stream_sequence=(SELECT max(current_event.stream_sequence)');
 definition:=replace(definition,'ORDER BY o.code,c.profile,e.head','ORDER BY o.code,c.profile,e.stream_sequence');
 EXECUTE definition;

 FOREACH routine IN ARRAY ARRAY['governance_catalog.contract_change_impact(text,text,uuid,text)','governance_catalog.contract_impact_cases(text,text,uuid)'] LOOP
  definition:=pg_get_functiondef(routine::regprocedure);
  definition:=replace(replace(replace(definition,'ORDER BY head DESC','ORDER BY stream_sequence DESC'),',head DESC',',stream_sequence DESC'),'max(head)','max(stream_sequence)');
  EXECUTE definition;
 END LOOP;

 definition:=pg_get_functiondef('governance_catalog.source_proposed_impact(uuid,text)'::regprocedure);
 -- An impact-set fingerprint correlates streams without imposing a total order.
 definition:=replace(definition,'(SELECT coalesce(max(head),0)::text FROM governance_catalog.import_contract_event)',
  '(SELECT encode(sha256(convert_to(coalesce(string_agg(contract_id::text||'':''||sequence::text,''|'' ORDER BY contract_id),''''),''UTF8'')),''hex'') FROM (SELECT contract_id,max(stream_sequence) AS sequence FROM governance_catalog.import_contract_event GROUP BY contract_id) streams)');
 definition:=replace(replace(definition,'ORDER BY head DESC','ORDER BY stream_sequence DESC'),'max(head)','max(stream_sequence)');
 EXECUTE definition;
END $stream_consumers$;
