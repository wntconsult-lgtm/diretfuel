-- Referência SQL da migração remota directfuel_initial_import.
CREATE FUNCTION public.directfuel_initial_import(p_user_id uuid,p_email text,p_version bigint,p_state jsonb,p_events jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actor directfuel.members; result jsonb; backup_id uuid;
BEGIN
 actor:=directfuel.require_owner(p_user_id,p_email);
 PERFORM 1 FROM directfuel.state_revision WHERE id='main' FOR UPDATE;
 IF EXISTS (SELECT 1 FROM directfuel.records WHERE collection_name NOT IN ('users','audit','config') AND payload NOT IN ('null'::jsonb,'{}'::jsonb,'[]'::jsonb)) THEN
   RAISE SQLSTATE 'PT409' USING MESSAGE='A cópia já possui dados. A importação inicial não pode substituir uma base preenchida.';
 END IF;
 result:=public.directfuel_state_write(p_user_id,p_email,p_version,p_state,p_events,true);
 backup_id:=directfuel.make_backup(actor.id,p_state,(result->>'version')::bigint,'Importação inicial');
 RETURN result || jsonb_build_object('backupId',backup_id);
END $$;
REVOKE ALL ON FUNCTION public.directfuel_initial_import(uuid,text,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.directfuel_initial_import(uuid,text,bigint,jsonb,jsonb) TO service_role;
