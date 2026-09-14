-- Validate the complete closed variant without changing installed migration history.
SELECT pg_advisory_xact_lock(901002);
ALTER TABLE governance_catalog.import_input_revision
 ADD CONSTRAINT import_input_revision_metadata_shape_check CHECK (
  CASE WHEN jsonb_typeof(metadata)='object' THEN
   ((metadata->>'kind'='FILE' AND metadata->>'format' IN ('CSV','JSON','XLSX')
     AND metadata->>'parserPolicy'='STRICT_V1'
     AND metadata - ARRAY['kind','format','parserPolicy']='{}'::jsonb)
    OR (metadata->>'kind'='METADATA_ONLY' AND jsonb_typeof(metadata->'declaredSha256')='string'
     AND metadata->>'declaredSha256' ~ '^[a-f0-9]{64}$'
     AND metadata - ARRAY['kind','declaredSha256']='{}'::jsonb)) IS TRUE
   ELSE false END
 );
