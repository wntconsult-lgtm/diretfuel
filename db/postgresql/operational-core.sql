-- Referência SQL: migração remota directfuel_operational_core.
-- Credenciais de serviço somente no backend; os clientes não executam RPCs.
ALTER TABLE directfuel.backups ADD COLUMN reason text NOT NULL DEFAULT 'Automático';
CREATE TABLE directfuel.backup_payloads (
  backup_id uuid PRIMARY KEY REFERENCES directfuel.backups(id) ON DELETE CASCADE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
ALTER TABLE directfuel.backup_payloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON directfuel.backup_payloads FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,DELETE ON directfuel.backup_payloads TO service_role;

CREATE FUNCTION directfuel.require_owner(p_user uuid,p_email text)
RETURNS directfuel.members LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m directfuel.members;
BEGIN
  SELECT * INTO m FROM directfuel.members WHERE auth_user_id=p_user
    AND email=lower(trim(p_email)) AND email='wnt.consult@gmail.com'
    AND active AND profile='Master' FOR SHARE;
  IF m.id IS NULL THEN RAISE SQLSTATE 'PT403' USING MESSAGE='Acesso não autorizado à cópia de testes.'; END IF;
  RETURN m;
END $$;
REVOKE ALL ON FUNCTION directfuel.require_owner(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION directfuel.require_owner(uuid,text) TO service_role;

CREATE FUNCTION directfuel.snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT COALESCE(jsonb_object_agg(c.name,CASE WHEN c.kind='array' THEN
    COALESCE((SELECT jsonb_agg(r.payload ORDER BY r.sort_order,r.record_id) FROM directfuel.records r WHERE r.collection_name=c.name),'[]'::jsonb)
    ELSE (SELECT r.payload FROM directfuel.records r WHERE r.collection_name=c.name AND r.record_id='$value') END),'{}'::jsonb)
  FROM directfuel.collections c;
$$;
REVOKE ALL ON FUNCTION directfuel.snapshot() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION directfuel.snapshot() TO service_role;

CREATE FUNCTION public.directfuel_state_read(p_user_id uuid,p_email text,p_known_version bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m directfuel.members; meta directfuel.state_revision; s jsonb; events jsonb;
BEGIN
  m:=directfuel.require_owner(p_user_id,p_email);
  SELECT * INTO meta FROM directfuel.state_revision WHERE id='main' FOR SHARE;
  IF p_known_version=meta.revision THEN RETURN jsonb_build_object('unchanged',true,'version',meta.revision); END IF;
  s:=directfuel.snapshot();
  SELECT COALESCE(jsonb_agg(e.data),'[]'::jsonb) INTO events FROM (
    SELECT jsonb_build_object('id',a.id,'data',a.created_at,'usuario',u.email,
      'acao',a.event_type,'entidade',a.entity_type,'detalhe',a.details->>'summary','version',a.details->'revision') AS data
    FROM directfuel.audit_events a LEFT JOIN directfuel.members u ON u.id=a.actor_id
    ORDER BY a.created_at DESC,a.id DESC LIMIT 300) e;
  RETURN jsonb_build_object('state',CASE WHEN meta.revision=0 AND s='{}'::jsonb THEN NULL ELSE s||jsonb_build_object('audit',events) END,
    'version',meta.revision,'updatedAt',meta.updated_at,'updatedBy',(SELECT email FROM directfuel.members WHERE id=meta.updated_by),
    'user',jsonb_build_object('email',m.email,'name',m.display_name,'profile',m.profile,'permissions',m.permissions,'actions',m.actions,'isOwner',true));
END $$;

CREATE FUNCTION directfuel.make_backup(p_actor uuid,p_state jsonb,p_revision bigint,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE bid uuid:=gen_random_uuid(); content jsonb; raw text; digest text; deleted_ids jsonb; freed bigint;
BEGIN
  content:=jsonb_build_object('state',p_state,'version',p_revision,'createdAt',now(),'reason',p_reason);
  raw:=content::text; digest:=encode(sha256(convert_to(raw,'UTF8')),'hex');
  INSERT INTO directfuel.backups(id,bucket_id,object_path,state_revision,byte_size,sha256,created_by,reason,created_at)
    VALUES(bid,'postgres-private','backups/'||bid::text,p_revision,octet_length(raw),digest,p_actor,p_reason,clock_timestamp());
  INSERT INTO directfuel.backup_payloads(backup_id,payload) VALUES(bid,content);
  IF NOT EXISTS (SELECT 1 FROM directfuel.backup_payloads p WHERE p.backup_id=bid AND
    encode(sha256(convert_to(p.payload::text,'UTF8')),'hex')=digest AND p.payload->'state'=p_state) THEN
    RAISE EXCEPTION 'Falha na validação do backup. Nenhuma cópia antiga foi removida.';
  END IF;
  UPDATE directfuel.backups SET validated_at=now() WHERE id=bid;
  INSERT INTO directfuel.audit_events(actor_id,event_type,entity_type,entity_id,details)
    VALUES(p_actor,'Backup validado','backups',bid::text,jsonb_build_object('revision',p_revision,'bytes',octet_length(raw),'summary',p_reason));
  -- Callers lock the singleton revision row first: rotations cannot overlap.
  SELECT COALESCE(jsonb_agg(b.id),'[]'::jsonb),COALESCE(sum(b.byte_size),0) INTO deleted_ids,freed
    FROM (SELECT id,byte_size FROM directfuel.backups WHERE validated_at IS NOT NULL
      ORDER BY created_at DESC,id DESC OFFSET 5) b WHERE b.id<>bid;
  DELETE FROM directfuel.backup_payloads WHERE backup_id IN (SELECT v::uuid FROM jsonb_array_elements_text(deleted_ids) v);
  DELETE FROM directfuel.backups WHERE id IN (SELECT v::uuid FROM jsonb_array_elements_text(deleted_ids) v);
  INSERT INTO directfuel.audit_events(actor_id,event_type,entity_type,entity_id,details)
    VALUES(p_actor,'Retenção de backups','backups',bid::text,jsonb_build_object('created',bid,'removed',deleted_ids,'freedBytes',freed,'limit',5,'revision',p_revision));
  RETURN bid;
END $$;
REVOKE ALL ON FUNCTION directfuel.make_backup(uuid,jsonb,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION directfuel.make_backup(uuid,jsonb,bigint,text) TO service_role;

CREATE FUNCTION public.directfuel_state_write(p_user_id uuid,p_email text,p_version bigint,p_state jsonb,p_events jsonb,p_destructive boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m directfuel.members; meta directfuel.state_revision; item record; ids text[]; event jsonb; old jsonb; bid uuid;
BEGIN
  m:=directfuel.require_owner(p_user_id,p_email);
  SELECT * INTO meta FROM directfuel.state_revision WHERE id='main' FOR UPDATE;
  IF p_version IS NULL OR meta.revision<>p_version THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Os dados foram alterados por outro usuário. Recarregue antes de salvar.'; END IF;
  IF jsonb_typeof(p_state) IS DISTINCT FROM 'object' OR jsonb_typeof(p_events) IS DISTINCT FROM 'array' THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Estado inválido.'; END IF;
  p_state:=p_state-'audit';
  old:=directfuel.snapshot();
  IF meta.revision>0 AND (p_destructive OR NOT EXISTS (
    SELECT 1 FROM directfuel.backups WHERE validated_at IS NOT NULL AND
    (created_at AT TIME ZONE 'America/Sao_Paulo')::date=(now() AT TIME ZONE 'America/Sao_Paulo')::date)) THEN
    bid:=directfuel.make_backup(m.id,old,meta.revision,CASE WHEN p_destructive THEN 'Antes de exclusão ou restauração' ELSE 'Diário' END);
  END IF;
  DELETE FROM directfuel.records WHERE NOT (p_state ? collection_name);
  DELETE FROM directfuel.collections WHERE NOT (p_state ? name);
  FOR item IN SELECT key,value FROM jsonb_each(p_state) LOOP
    IF item.key !~ '^[A-Za-z][A-Za-z0-9_]*$' OR item.key IN ('__proto__','constructor','prototype') THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE='Nome de coleção inválido.';
    END IF;
    INSERT INTO directfuel.collections(name,kind) VALUES(item.key,CASE WHEN jsonb_typeof(item.value)='array' THEN 'array' ELSE 'value' END)
      ON CONFLICT(name) DO UPDATE SET kind=EXCLUDED.kind,updated_at=now();
    IF jsonb_typeof(item.value)='array' THEN
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(item.value) a WHERE jsonb_typeof(a)<>'object' OR jsonb_typeof(a->'id')<>'string' OR COALESCE(a->>'id','')='')
        OR (SELECT count(*)<>count(DISTINCT a->>'id') FROM jsonb_array_elements(item.value) a) THEN
        SELECT COALESCE(array_agg('$index_'||n::text),ARRAY[]::text[]) INTO ids FROM jsonb_array_elements(item.value) WITH ORDINALITY a(v,n);
        INSERT INTO directfuel.records(collection_name,record_id,sort_order,payload)
          SELECT item.key,'$index_'||n::text,n-1,v FROM jsonb_array_elements(item.value) WITH ORDINALITY a(v,n)
          ON CONFLICT(collection_name,record_id) DO UPDATE SET sort_order=EXCLUDED.sort_order,payload=EXCLUDED.payload,updated_at=now()
          WHERE directfuel.records.payload IS DISTINCT FROM EXCLUDED.payload OR directfuel.records.sort_order<>EXCLUDED.sort_order;
      ELSE
        SELECT COALESCE(array_agg(v->>'id'),ARRAY[]::text[]) INTO ids FROM jsonb_array_elements(item.value) a(v);
        INSERT INTO directfuel.records(collection_name,record_id,sort_order,payload)
          SELECT item.key,v->>'id',n-1,v FROM jsonb_array_elements(item.value) WITH ORDINALITY a(v,n)
          ON CONFLICT(collection_name,record_id) DO UPDATE SET sort_order=EXCLUDED.sort_order,payload=EXCLUDED.payload,updated_at=now()
          WHERE directfuel.records.payload IS DISTINCT FROM EXCLUDED.payload OR directfuel.records.sort_order<>EXCLUDED.sort_order;
      END IF;
    ELSE
      ids:=ARRAY['$value'];
      INSERT INTO directfuel.records(collection_name,record_id,sort_order,payload) VALUES(item.key,'$value',0,item.value)
        ON CONFLICT(collection_name,record_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()
        WHERE directfuel.records.payload IS DISTINCT FROM EXCLUDED.payload;
    END IF;
    DELETE FROM directfuel.records WHERE collection_name=item.key AND NOT(record_id=ANY(ids));
  END LOOP;
  FOR event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    INSERT INTO directfuel.audit_events(actor_id,event_type,entity_type,details)
      VALUES(m.id,'Alteração validada',COALESCE(event->>'collection','state'),event||jsonb_build_object('revision',meta.revision+1));
  END LOOP;
  UPDATE directfuel.state_revision SET revision=meta.revision+1,updated_at=now(),updated_by=m.id WHERE id='main';
  RETURN jsonb_build_object('ok',true,'version',meta.revision+1,'updatedAt',now(),'backupId',bid);
END $$;

CREATE FUNCTION public.directfuel_security(p_user_id uuid,p_email text,p_action text DEFAULT 'list',p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m directfuel.members; meta directfuel.state_revision; result jsonb; bid uuid;
BEGIN
  m:=directfuel.require_owner(p_user_id,p_email);
  IF p_action='create_backup' THEN
    SELECT * INTO meta FROM directfuel.state_revision WHERE id='main' FOR UPDATE;
    bid:=directfuel.make_backup(m.id,directfuel.snapshot(),meta.revision,'Manual');
    RETURN jsonb_build_object('ok',true,'backup',jsonb_build_object('id',bid));
  ELSIF p_action='download' THEN
    SELECT p.payload INTO result FROM directfuel.backup_payloads p JOIN directfuel.backups b ON b.id=p.backup_id
      WHERE b.id=p_id AND b.validated_at IS NOT NULL AND b.sha256=encode(sha256(convert_to(p.payload::text,'UTF8')),'hex');
    IF result IS NULL THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Backup indisponível ou inválido.'; END IF;
    RETURN result;
  ELSIF p_action='deleted_event' THEN
    SELECT details INTO result FROM directfuel.audit_events WHERE id=p_id AND jsonb_typeof(details->'deleted')='array';
    IF result IS NULL THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Registro excluído não encontrado.'; END IF;
    RETURN result;
  ELSIF p_action<>'list' THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Ação inválida.'; END IF;
  RETURN jsonb_build_object('isMaster',true,
    'deleted',COALESCE((SELECT jsonb_agg(r) FROM (SELECT a.id::text||'::'||(d->>'id') AS id,a.entity_type AS collection,d->>'id' AS record_id,a.created_at AS deleted_at,u.email AS deleted_by
      FROM directfuel.audit_events a CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.details->'deleted','[]'::jsonb)) d
      LEFT JOIN directfuel.members u ON u.id=a.actor_id
      WHERE NOT EXISTS(SELECT 1 FROM directfuel.records x WHERE x.collection_name=a.entity_type AND x.record_id=d->>'id')
      ORDER BY a.created_at DESC LIMIT 200) r),'[]'::jsonb),
    'accesses',COALESCE((SELECT jsonb_agg(r) FROM (SELECT a.id,u.email AS user_email,u.display_name,a.event_type AS event,a.details->>'route' AS route,a.created_at,a.details->>'userAgent' AS user_agent
      FROM directfuel.audit_events a LEFT JOIN directfuel.members u ON u.id=a.actor_id WHERE a.event_type='Acesso autorizado' ORDER BY a.created_at DESC LIMIT 1000) r),'[]'::jsonb),
    'backups',COALESCE((SELECT jsonb_agg(r) FROM (SELECT b.id,b.state_revision AS state_version,b.reason,b.created_at,creator.email AS created_by,b.byte_size AS size_bytes
      FROM directfuel.backups b LEFT JOIN directfuel.members creator ON creator.id=b.created_by WHERE b.validated_at IS NOT NULL ORDER BY b.created_at DESC,b.id DESC) r),'[]'::jsonb),
    'audits',COALESCE((SELECT jsonb_agg(r) FROM (SELECT a.id,a.created_at,u.email AS user_email,a.event_type AS action,a.entity_type AS entity,a.details::text AS detail,a.details->'revision' AS state_version
      FROM directfuel.audit_events a LEFT JOIN directfuel.members u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id DESC LIMIT 300) r),'[]'::jsonb));
END $$;

CREATE FUNCTION public.directfuel_audit(p_user_id uuid,p_email text,p_action text,p_entity text,p_details jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m directfuel.members;
BEGIN
  m:=directfuel.require_owner(p_user_id,p_email);
  INSERT INTO directfuel.audit_events(actor_id,event_type,entity_type,details) VALUES(m.id,p_action,p_entity,p_details);
  RETURN jsonb_build_object('ok',true);
END $$;

REVOKE ALL ON FUNCTION public.directfuel_state_read(uuid,text,bigint),public.directfuel_state_write(uuid,text,bigint,jsonb,jsonb,boolean),public.directfuel_security(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.directfuel_state_read(uuid,text,bigint),public.directfuel_state_write(uuid,text,bigint,jsonb,jsonb,boolean),public.directfuel_security(uuid,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.directfuel_audit(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.directfuel_audit(uuid,text,text,text,jsonb) TO service_role;
