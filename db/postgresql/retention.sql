-- Referência SQL final: documentos privados e exclusão de arquivos concluídos.
CREATE OR REPLACE FUNCTION public.directfuel_document(p_user_id uuid,p_email text,p_action text,p_document_id text DEFAULT NULL,p_metadata jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m directfuel.members; meta directfuel.state_revision; doc directfuel.documents;
BEGIN
 m:=directfuel.require_owner(p_user_id,p_email);
 IF p_action='context' THEN
   SELECT * INTO meta FROM directfuel.state_revision WHERE id='main' FOR SHARE;
   RETURN jsonb_build_object('revision',meta.revision,'user',jsonb_build_object('email',m.email,'name',m.display_name,'profile',m.profile));
 ELSIF p_action='list' THEN
   RETURN (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]'::jsonb) FROM directfuel.documents d);
 ELSIF p_action='stats' THEN
   RETURN (SELECT jsonb_build_object('count',count(*),'bytes',COALESCE(sum(byte_size),0),'cleanupPending',(SELECT count(*) FROM directfuel.documents WHERE cleanup_pending),'cleanupPendingBytes',(SELECT COALESCE(sum(byte_size),0) FROM directfuel.documents WHERE cleanup_pending)) FROM directfuel.documents WHERE removed_at IS NULL);
 END IF;
 IF p_document_id IS NULL OR p_document_id !~ '^[A-Za-z0-9_-]{1,100}:(pdf|xml)$' THEN
   RAISE SQLSTATE 'PT400' USING MESSAGE='Documento inválido.';
 END IF;
 IF p_action='remove_completed' OR (p_action='put' AND COALESCE((p_metadata->>'onlyMissing')::boolean,false)) THEN
   SELECT * INTO meta FROM directfuel.state_revision WHERE id='main' FOR UPDATE;
   IF (p_metadata->>'version') IS NULL OR meta.revision<>(p_metadata->>'version')::bigint THEN RAISE SQLSTATE 'PT409' USING MESSAGE='A base mudou. Analise novamente antes de excluir.';END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_document_id,0));
 SELECT * INTO doc FROM directfuel.documents WHERE id=p_document_id FOR UPDATE;
 IF p_action='get' THEN
   IF doc.id IS NULL OR doc.removed_at IS NOT NULL THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Documento ainda não migrado ou não encontrado.'; END IF;
   RETURN to_jsonb(doc);
 ELSIF p_action='put' THEN
   IF COALESCE((p_metadata->>'onlyMissing')::boolean,false) AND doc.id IS NOT NULL AND doc.removed_at IS NULL THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Este arquivo já foi migrado. Atualize a lista.';END IF;
   IF left(p_document_id,10)='NF_LAYOUT_' AND doc.id IS NOT NULL THEN RAISE SQLSTATE 'PT409' USING MESSAGE='O PDF de referência de um layout é imutável.'; END IF;
   INSERT INTO directfuel.documents(id,measurement_id,bucket_id,object_path,original_filename,content_type,byte_size,sha256,created_by)
     VALUES(p_document_id,split_part(p_document_id,':',1),'directfuel-documents',p_metadata->>'path',p_metadata->>'filename',p_metadata->>'type',(p_metadata->>'bytes')::bigint,p_metadata->>'sha256',m.id)
     ON CONFLICT(id) DO UPDATE SET object_path=EXCLUDED.object_path,original_filename=EXCLUDED.original_filename,content_type=EXCLUDED.content_type,byte_size=EXCLUDED.byte_size,sha256=EXCLUDED.sha256,created_by=m.id,created_at=clock_timestamp(),removed_at=NULL,removed_by=NULL,cleanup_pending=false;
   INSERT INTO directfuel.audit_events(actor_id,event_type,entity_type,entity_id,details) VALUES(m.id,'Documento enviado','documents',p_document_id,p_metadata-'path');
   RETURN jsonb_build_object('ok',true,'oldPath',doc.object_path);
 ELSIF p_action='cleanup_complete' THEN
   IF doc.id IS NULL OR doc.removed_at IS NULL OR doc.object_path IS DISTINCT FROM p_metadata->>'path' THEN RAISE SQLSTATE 'PT409' USING MESSAGE='O documento mudou durante a limpeza.';END IF;
   UPDATE directfuel.documents SET cleanup_pending=false WHERE id=p_document_id;
   INSERT INTO directfuel.audit_events(actor_id,event_type,entity_type,entity_id,details) VALUES(m.id,'Limpeza física confirmada','documents',p_document_id,jsonb_build_object('bytes',doc.byte_size));
   RETURN jsonb_build_object('ok',true);
 ELSIF p_action IN ('remove','remove_completed','remove_retention') THEN
   IF left(p_document_id,10)='NF_LAYOUT_' THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Os PDFs de referência dos layouts são preservados.'; END IF;
   IF doc.id IS NULL THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Documento não encontrado.'; END IF;
   IF p_action IN ('remove_completed','remove_retention') AND (doc.removed_at IS NOT NULL OR doc.sha256 IS DISTINCT FROM p_metadata->>'sha256') THEN RAISE SQLSTATE 'PT409' USING MESSAGE='O arquivo mudou. Analise novamente.';END IF;
   UPDATE directfuel.documents SET removed_at=COALESCE(removed_at,now()),removed_by=m.id,cleanup_pending=true WHERE id=p_document_id;
   INSERT INTO directfuel.audit_events(actor_id,event_type,entity_type,entity_id,details) VALUES(m.id,'Documento removido','documents',p_document_id,jsonb_build_object('bytes',doc.byte_size,'summary',doc.original_filename,'references',p_metadata->'references'));
   RETURN to_jsonb(doc);
 END IF;
 RAISE SQLSTATE 'PT400' USING MESSAGE='Ação inválida.';
END $$;
REVOKE ALL ON FUNCTION public.directfuel_document(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.directfuel_document(uuid,text,text,text,jsonb) TO service_role;

-- Migração remota directfuel_atomic_retention. Somente o backend chama esta RPC.
CREATE FUNCTION public.directfuel_retention(p_user_id uuid,p_email text,p_version bigint,p_state jsonb,p_events jsonb,p_documents jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; entry jsonb; doc jsonb; removed jsonb:='[]'::jsonb;
BEGIN
 PERFORM directfuel.require_owner(p_user_id,p_email);
 IF jsonb_typeof(p_documents) IS DISTINCT FROM 'array' OR jsonb_array_length(p_documents)>1000 THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Lista de arquivos inválida.';END IF;
 -- The existing writer creates and validates a backup before changing anything.
 result:=public.directfuel_state_write(p_user_id,p_email,p_version,p_state,p_events,true);
 FOR entry IN SELECT value FROM jsonb_array_elements(p_documents) ORDER BY value->>'id' LOOP
  doc:=public.directfuel_document(p_user_id,p_email,'remove_retention',entry->>'id',jsonb_build_object('sha256',entry->>'sha256'));
  removed:=removed||jsonb_build_array(jsonb_build_object('id',doc->>'id','object_path',doc->>'object_path','byte_size',doc->'byte_size'));
 END LOOP;
 RETURN result||jsonb_build_object('documents',removed);
END $$;
REVOKE ALL ON FUNCTION public.directfuel_retention(uuid,text,bigint,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.directfuel_retention(uuid,text,bigint,jsonb,jsonb,jsonb) TO service_role;
