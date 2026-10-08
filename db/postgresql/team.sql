-- Referência de migração remota: acesso da equipe, com vínculo individual aprovado pelo proprietário.
CREATE OR REPLACE FUNCTION directfuel.require_member(p_user uuid,p_email text)
RETURNS directfuel.members LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m directfuel.members; u jsonb;
BEGIN
 SELECT * INTO m FROM directfuel.members WHERE auth_user_id=p_user AND email=lower(trim(p_email)) AND active FOR SHARE;
 IF m.id IS NULL THEN RAISE SQLSTATE 'PT403' USING MESSAGE='Sua conta não está liberada para esta cópia.'; END IF;
 IF m.email='wnt.consult@gmail.com' AND m.profile='Master' THEN RETURN m; END IF;
 SELECT payload INTO u FROM directfuel.records WHERE collection_name='users' AND lower(trim(payload->>'email'))=m.email LIMIT 1;
 IF u IS NULL OR u->>'ativo'='false' OR u->>'perfil'='Master' THEN RAISE SQLSTATE 'PT403' USING MESSAGE='Seu acesso foi desativado.'; END IF;
 m.profile:=CASE WHEN u->>'perfil' IN('Administrador','Admin') THEN 'Administrador' WHEN u->>'perfil'='Gestor' THEN 'Gestor' ELSE 'Usuário' END;
 m.display_name:=COALESCE(u->>'nome',m.display_name);
 m.permissions:=COALESCE(u->'permissoes','[]'::jsonb);m.actions:=COALESCE(u->'acoes','[]'::jsonb);
 IF jsonb_typeof(m.permissions)<>'array' OR jsonb_typeof(m.actions)<>'array' THEN RAISE SQLSTATE 'PT403' USING MESSAGE='Permissões inválidas.';END IF;
 RETURN m;
END $$;
REVOKE ALL ON FUNCTION directfuel.require_member(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION directfuel.require_member(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION directfuel.member_can(m directfuel.members,p_permission text,p_action text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT (m).active AND ((m).email='wnt.consult@gmail.com' AND (m).profile='Master' OR
 CASE WHEN p_action IS NULL THEN (m).permissions ? '*' OR (m).permissions ? p_permission OR (m).actions ? '*' OR (m).actions ? (p_permission||':visualizar')
 ELSE (m).actions ? '*' OR (m).actions ? (p_permission||':'||p_action) END);
$$;
REVOKE ALL ON FUNCTION directfuel.member_can(directfuel.members,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION directfuel.member_can(directfuel.members,text,text) TO service_role;

-- Somente estes RPCs passam a aceitar membros aprovados. Segurança, restauração, importação e retenção continuam exclusivos do proprietário.
DO $replace$
DECLARE signature text; definition text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.directfuel_state_read(uuid,text,bigint)','public.directfuel_state_write(uuid,text,bigint,jsonb,jsonb,boolean)','public.directfuel_audit(uuid,text,text,text,jsonb)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=replace(definition,'directfuel.require_owner(','directfuel.require_member(');
  IF signature LIKE '%state_read%' THEN definition:=replace(definition,'''isOwner'',true','''isOwner'',m.email=''wnt.consult@gmail.com'' AND m.profile=''Master''');END IF;
  EXECUTE definition;
 END LOOP;
END $replace$;

CREATE OR REPLACE FUNCTION public.directfuel_team(p_user_id uuid,p_email text,p_action text,p_id text DEFAULT NULL,p_metadata jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE owner directfuel.members; u jsonb; e text; profile text; bound uuid;
BEGIN
 owner:=directfuel.require_owner(p_user_id,p_email);
 IF p_action='list' THEN
  RETURN jsonb_build_object('version',(SELECT revision FROM directfuel.state_revision WHERE id='main'),'users',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.record_id,'email',lower(trim(r.payload->>'email')),'name',r.payload->>'nome','profile',r.payload->>'perfil','enabled',COALESCE(r.payload->>'ativo','true')<>'false','released',COALESCE(m.active,false),'bound',m.auth_user_id IS NOT NULL,'permissions',COALESCE(r.payload->'permissoes','[]'::jsonb),'actions',COALESCE(r.payload->'acoes','[]'::jsonb)) ORDER BY lower(r.payload->>'email')) FROM directfuel.records r LEFT JOIN directfuel.members m ON m.email=lower(trim(r.payload->>'email')) WHERE r.collection_name='users' AND lower(trim(r.payload->>'email'))<>owner.email),'[]'::jsonb));
 END IF;
 SELECT payload INTO u FROM directfuel.records WHERE collection_name='users' AND record_id=p_id FOR SHARE;
 IF u IS NULL THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Cadastro de usuário não encontrado.';END IF;
 e:=lower(trim(u->>'email'));
 IF e=owner.email OR u->>'perfil'='Master' THEN RAISE SQLSTATE 'PT403' USING MESSAGE='O proprietário é preservado.';END IF;
 IF e IS NULL OR length(e)>254 OR e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Corrija o e-mail no cadastro.';END IF;
 IF (SELECT count(*) FROM directfuel.records WHERE collection_name='users' AND lower(trim(payload->>'email'))=e)<>1 THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Há cadastros duplicados para este e-mail.';END IF;
 IF p_action='disable' THEN
  UPDATE directfuel.members SET active=false,updated_at=now() WHERE email=e AND profile<>'Master';
  INSERT INTO directfuel.audit_events(actor_id,event_type,entity_type,entity_id,details) VALUES(owner.id,'Acesso da equipe desativado','members',e,jsonb_build_object('summary','Acesso desativado pelo proprietário'));
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF u->>'ativo'='false' THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Ative o cadastro antes de liberar o acesso.';END IF;
 profile:=CASE WHEN u->>'perfil' IN('Administrador','Admin') THEN 'Administrador' WHEN u->>'perfil'='Gestor' THEN 'Gestor' WHEN u->>'perfil' IN('Operador','Usuário','Usuario') THEN 'Usuário' END;
 IF profile IS NULL OR jsonb_typeof(COALESCE(u->'permissoes','[]'::jsonb))<>'array' OR jsonb_typeof(COALESCE(u->'acoes','[]'::jsonb))<>'array' THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Corrija o perfil e as permissões do cadastro.';END IF;
 SELECT auth_user_id INTO bound FROM directfuel.members WHERE email=e;
 IF p_action='candidate' THEN RETURN jsonb_build_object('email',e,'name',u->>'nome','profile',profile,'version',(SELECT revision FROM directfuel.state_revision WHERE id='main'),'bound',bound IS NOT NULL);END IF;
 IF p_action<>'activate' OR p_metadata->>'authUserId' IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Ação inválida.';END IF;
 PERFORM 1 FROM directfuel.state_revision WHERE id='main' FOR SHARE;
 IF (p_metadata->>'version')::bigint IS DISTINCT FROM (SELECT revision FROM directfuel.state_revision WHERE id='main') THEN RAISE SQLSTATE 'PT409' USING MESSAGE='O cadastro mudou. Atualize os acessos.';END IF;
 INSERT INTO directfuel.members(email,auth_user_id,display_name,profile,active,permissions,actions)
 VALUES(e,(p_metadata->>'authUserId')::uuid,COALESCE(u->>'nome',e),profile,true,COALESCE(u->'permissoes','[]'::jsonb),COALESCE(u->'acoes','[]'::jsonb))
 ON CONFLICT(email) DO UPDATE SET auth_user_id=EXCLUDED.auth_user_id,display_name=EXCLUDED.display_name,profile=EXCLUDED.profile,active=true,permissions=EXCLUDED.permissions,actions=EXCLUDED.actions,updated_at=now();
 INSERT INTO directfuel.audit_events(actor_id,event_type,entity_type,entity_id,details) VALUES(owner.id,'Acesso da equipe liberado','members',e,jsonb_build_object('summary','Liberação individual com permissões do cadastro','profile',profile));
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.directfuel_team(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.directfuel_team(uuid,text,text,text,jsonb) TO service_role;

-- Referência SQL final: documentos privados e exclusão de arquivos concluídos.
CREATE OR REPLACE FUNCTION public.directfuel_document(p_user_id uuid,p_email text,p_action text,p_document_id text DEFAULT NULL,p_metadata jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m directfuel.members; meta directfuel.state_revision; doc directfuel.documents;
BEGIN
 m:=directfuel.require_member(p_user_id,p_email);
 IF p_action NOT IN('context','get','put','remove') OR (p_action='put' AND COALESCE((p_metadata->>'onlyMissing')::boolean,false)) THEN
  PERFORM directfuel.require_owner(p_user_id,p_email);
 ELSIF p_action<>'context' THEN
  IF left(COALESCE(p_document_id,''),10)='NF_LAYOUT_' THEN
   IF NOT directfuel.member_can(m,'postos',CASE WHEN p_action='get' THEN NULL ELSE 'incluir' END) THEN RAISE SQLSTATE 'PT403' USING MESSAGE='Acesso ao layout não autorizado.';END IF;
  ELSIF NOT(directfuel.member_can(m,'documentos',CASE p_action WHEN 'put' THEN 'incluir' WHEN 'remove' THEN 'excluir' END) OR directfuel.member_can(m,'medicoes',CASE p_action WHEN 'put' THEN 'incluir' WHEN 'remove' THEN 'excluir' END)) THEN RAISE SQLSTATE 'PT403' USING MESSAGE='Acesso ao documento não autorizado.';END IF;
 END IF;
 IF p_action='context' THEN
   SELECT * INTO meta FROM directfuel.state_revision WHERE id='main' FOR SHARE;
   RETURN jsonb_build_object('revision',meta.revision,'user',jsonb_build_object('email',m.email,'name',m.display_name,'profile',m.profile,'permissions',m.permissions,'actions',m.actions,'isOwner',m.email='wnt.consult@gmail.com' AND m.profile='Master'));
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

-- Aplicação remota: directfuel_preview_access (projeto de testes).
-- A identidade vem de Auth /user, verificada pela Edge Function.
-- SECURITY INVOKER: clientes não têm EXECUTE nem acesso ao schema privado.
CREATE OR REPLACE FUNCTION public.directfuel_preview_access(p_user_id uuid, p_email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'user', jsonb_build_object('email', m.email, 'name', m.display_name, 'profile', m.profile, 'isOwner',m.email='wnt.consult@gmail.com' AND m.profile='Master'),
    'revision', (SELECT revision FROM directfuel.state_revision WHERE id = 'main'),
    'collections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', c.name, 'records',
        (SELECT count(*) FROM directfuel.records r WHERE r.collection_name = c.name)) ORDER BY c.name)
      FROM directfuel.collections c
    ), '[]'::jsonb),
    'documents', (SELECT count(*) FROM directfuel.documents WHERE removed_at IS NULL),
    'backups', (SELECT count(*) FROM directfuel.backups WHERE validated_at IS NOT NULL),
    'mode', 'migration-preview'
  ) FROM directfuel.require_member(p_user_id,p_email) m;
$$;
REVOKE ALL ON FUNCTION public.directfuel_preview_access(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.directfuel_preview_access(uuid, text) TO service_role;
COMMENT ON FUNCTION public.directfuel_preview_access(uuid, text) IS
  'Resumo privado de testes. Somente service_role após validar Auth; não retorna registros fiscais ou permite gravações.';
