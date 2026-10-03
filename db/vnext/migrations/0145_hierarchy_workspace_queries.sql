SELECT pg_advisory_xact_lock(901002);
CREATE FUNCTION department_master.hierarchy_workspace_query(p_actor text,p_mode text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h department_master.hierarchy_view;v department_master.hierarchy_view_version;c department_master.hierarchy_candidate;
 items jsonb:='[]';result jsonb;selected_view uuid:=(p_input->>'viewId')::uuid;lim integer:=coalesce((p_input->>'limit')::integer,50);
 at_record timestamp:=coalesce((p_input->>'recordAsOf')::timestamp,timezone('Asia/Shanghai',clock_timestamp()));state text;can_write boolean;can_review boolean;name text;
BEGIN
 PERFORM pg_advisory_xact_lock(901002);PERFORM department_master.authorize(p_actor,'HOSPITAL','READ');
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR lim NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
 IF p_mode='VIEWS' THEN
  IF p_input-ARRAY['after','limit','recordAsOf']<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  FOR h IN SELECT * FROM department_master.hierarchy_view WHERE created_at<=at_record AND (NOT (p_input?'after') OR id>(p_input->>'after')::uuid) ORDER BY id LOOP
   BEGIN PERFORM department_master.hierarchy_authorize(p_actor,h.id,'READ');EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE;END IF;CONTINUE;END;
   SELECT * INTO v FROM department_master.hierarchy_view_version WHERE view_id=h.id AND created_at<=at_record AND status='PUBLISHED' ORDER BY version_no DESC LIMIT 1;
   SELECT payload->>'viewName' INTO name FROM department_master.hierarchy_candidate WHERE view_id=h.id AND recorded_at<=at_record ORDER BY recorded_at DESC,id DESC LIMIT 1;
   SELECT status INTO state FROM department_master.hierarchy_closure WHERE view_id=h.id AND recorded_at<=at_record;
   state:=coalesce(state,CASE WHEN v.id IS NULL THEN 'DRAFT' ELSE 'PUBLISHED' END);
   can_write:=true;can_review:=true;
   BEGIN PERFORM department_master.hierarchy_authorize(p_actor,h.id,'WRITE');EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE;END IF;can_write:=false;END;
   BEGIN PERFORM department_master.hierarchy_authorize(p_actor,h.id,'REVIEW');EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE;END IF;can_review:=false;END;
   items:=items||jsonb_build_array(jsonb_build_object('viewId',h.id,'viewCode',h.view_code,'sourceClientKey',h.source_client_key,'viewName',coalesce(v.view_name,name),'state',state,'version',v.version_no::text,'versionId',v.id,'canWrite',can_write,'canReview',can_review,'recordedAt',to_char(h.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US')));
   IF jsonb_array_length(items)>=lim THEN EXIT;END IF;
  END LOOP;
  RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN jsonb_array_length(items)=lim THEN items->-1->>'viewId' ELSE NULL END);
 ELSIF p_mode='HISTORY' THEN
  IF selected_view IS NULL OR p_input-ARRAY['viewId','afterVersion','limit','recordAsOf']<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  PERFORM department_master.hierarchy_authorize(p_actor,selected_view,'READ');
  FOR v IN SELECT * FROM department_master.hierarchy_view_version q WHERE q.view_id=selected_view AND created_at<=at_record AND status='PUBLISHED' AND version_no>coalesce((p_input->>'afterVersion')::bigint,0) ORDER BY version_no LIMIT lim LOOP
   items:=items||jsonb_build_array(jsonb_build_object('version',v.version_no::text,'versionId',v.id));
  END LOOP;
  RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN jsonb_array_length(items)=lim THEN items->-1->>'version' ELSE NULL END);
 ELSIF p_mode='CANDIDATES' THEN
  IF p_input-ARRAY['viewId','after','limit','recordAsOf']<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF selected_view IS NOT NULL THEN PERFORM department_master.hierarchy_authorize(p_actor,selected_view,'READ');END IF;
  FOR c IN SELECT * FROM department_master.hierarchy_candidate q WHERE (selected_view IS NULL OR q.view_id=selected_view) AND recorded_at<=at_record AND (NOT (p_input?'after') OR id>(p_input->>'after')::uuid) ORDER BY id LOOP
   BEGIN PERFORM department_master.hierarchy_authorize(p_actor,c.view_id,'READ');EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ACCESS_DENIED' THEN RAISE;END IF;CONTINUE;END;
   state:=CASE WHEN c.applied_at<=at_record THEN 'APPLIED' WHEN c.approved_at<=at_record THEN 'APPROVED' ELSE 'VALIDATED' END;
   items:=items||jsonb_build_array(jsonb_build_object('candidateId',c.id,'viewId',c.view_id,'requestId',c.request_id,'digest',c.digest,'status',state,'maker',c.maker,'approvedBy',CASE WHEN c.approved_at<=at_record THEN c.approved_by ELSE NULL END,'recordedAt',to_char(c.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US')));
   IF jsonb_array_length(items)>=lim THEN EXIT;END IF;
  END LOOP;
  RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN jsonb_array_length(items)=lim THEN items->-1->>'candidateId' ELSE NULL END);
 ELSIF p_mode='WINDOW' THEN
  IF selected_view IS NULL OR NOT (p_input?'validFrom') OR NOT (p_input?'validTo') OR p_input-ARRAY['viewId','validFrom','validTo','recordAsOf']<>'{}'::jsonb THEN RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
  IF p_input->>'validTo' IS NOT NULL AND (p_input->>'validTo')::timestamp<=(p_input->>'validFrom')::timestamp THEN RAISE EXCEPTION 'INVALID_BUSINESS_PERIOD';END IF;
  PERFORM department_master.hierarchy_authorize(p_actor,selected_view,'READ');
  SELECT q.* INTO v FROM department_master.hierarchy_view_version q WHERE q.view_id=selected_view AND q.status='PUBLISHED' AND q.created_at<=at_record AND q.valid_from<=(p_input->>'validFrom')::timestamp AND (q.valid_to IS NULL OR p_input->>'validTo' IS NOT NULL AND q.valid_to>=(p_input->>'validTo')::timestamp)
   AND NOT EXISTS(SELECT 1 FROM department_master.hierarchy_view_version later WHERE later.view_id=q.view_id AND later.status='PUBLISHED' AND later.created_at<=at_record AND later.version_no>q.version_no AND tsrange(later.valid_from,later.valid_to,'[)')&&tsrange((p_input->>'validFrom')::timestamp,(p_input->>'validTo')::timestamp,'[)'))
   ORDER BY q.version_no DESC LIMIT 1;
  SELECT q.status INTO state FROM department_master.hierarchy_closure q WHERE q.view_id=selected_view AND q.recorded_at<=at_record;
  RETURN jsonb_build_object('version',v.version_no::text,'viewState',coalesce(state,'ACTIVE'),'selectionPolicy','FROZEN_PUBLICATION_WINDOW_V1');
 ELSE RAISE EXCEPTION 'CLOSED_INPUT_REQUIRED';END IF;
END $$;
REVOKE ALL ON FUNCTION department_master.hierarchy_workspace_query(text,text,jsonb) FROM PUBLIC,hdi_prototype;
