-- Referência SQL: migração remota directfuel_private_documents.
CREATE OR REPLACE FUNCTION public.directfuel_document(p_user_id uuid,p_email text,p_action text,p_document_id text DEFAULT NULL,p_metadata jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m directfuel.members; meta directfuel.state_revision; doc directfuel.documents;
BEGIN
 m:=directfuel.require_owner(p_user_id,p_email);
 IF p_action='context' THEN
   SELECT * INTO meta FROM directfuel.state_revision WHERE id='main' FOR SHARE;
   RETURN jsonb_build_object('revision',meta.revision,'user',jsonb_build_object('email',m.email,'name',m.display_name,'profile',m.profile));
 ELSIF p_action='stats' THEN
   RETURN (SELECT jsonb_build_object('count',count(*),'bytes',COALESCE(sum(byte_size),0)) FROM directfuel.documents WHERE removed_at IS NULL);
 END IF;
 IF p_document_id IS NULL OR p_document_id !~ '^[A-Za-z0-9_-]{1,100}:(pdf|xml)$' THEN
   RAISE SQLSTATE 'PT400' USING MESSAGE='Documento inválido.';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_document_id,0));
 SELECT * INTO doc FROM directfuel.documents WHERE id=p_document_id FOR UPDATE;
 IF p_action='get' THEN
   IF doc.id IS NULL OR doc.removed_at IS NOT NULL THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Documento ainda não migrado ou não encontrado.'; END IF;
   RETURN to_jsonb(doc);
 ELSIF p_action='put' THEN
   IF left(p_document_id,10)='NF_LAYOUT_' AND doc.id IS NOT NULL THEN RAISE SQLSTATE 'PT409' USING MESSAGE='O PDF de referência de um layout é imutável.'; END IF;
   INSERT INTO directfuel.documents(id,measurement_id,bucket_id,object_path,original_filename,content_type,byte_size,sha256,created_by)
     VALUES(p_document_id,split_part(p_document_id,':',1),'directfuel-documents',p_metadata->>'path',p_metadata->>'filename',p_metadata->>'type',(p_metadata->>'bytes')::bigint,p_metadata->>'sha256',m.id)
     ON CONFLICT(id) DO UPDATE SET object_path=EXCLUDED.object_path,original_filename=EXCLUDED.original_filename,content_type=EXCLUDED.content_type,byte_size=EXCLUDED.byte_size,sha256=EXCLUDED.sha256,created_by=m.id,created_at=clock_timestamp(),removed_at=NULL,removed_by=NULL;
   INSERT INTO directfuel.audit_events(actor_id,event_type,entity_type,entity_id,details) VALUES(m.id,'Documento enviado','documents',p_document_id,p_metadata-'path');
   RETURN jsonb_build_object('ok',true,'oldPath',doc.object_path);
 ELSIF p_action='remove' THEN
   IF left(p_document_id,10)='NF_LAYOUT_' THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Os PDFs de referência dos layouts são preservados.'; END IF;
   IF doc.id IS NULL THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Documento não encontrado.'; END IF;
   UPDATE directfuel.documents SET removed_at=now(),removed_by=m.id WHERE id=p_document_id;
   INSERT INTO directfuel.audit_events(actor_id,event_type,entity_type,entity_id,details) VALUES(m.id,'Documento removido','documents',p_document_id,jsonb_build_object('bytes',doc.byte_size,'summary',doc.original_filename));
   RETURN to_jsonb(doc);
 END IF;
 RAISE SQLSTATE 'PT400' USING MESSAGE='Ação inválida.';
END $$;
REVOKE ALL ON FUNCTION public.directfuel_document(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.directfuel_document(uuid,text,text,text,jsonb) TO service_role;
