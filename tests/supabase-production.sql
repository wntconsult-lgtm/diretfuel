-- Run inside BEGIN/ROLLBACK only. No test data may be committed.
SET LOCAL ROLE service_role;
DO $test$
DECLARE owner directfuel.members; before_state jsonb; candidate jsonb; after_state jsonb; rev bigint; result jsonb; rejected boolean:=false;
BEGIN
 IF (SELECT count(*) FROM directfuel.members WHERE active AND profile='Master')<>1 THEN RAISE EXCEPTION 'Expected exactly one active owner'; END IF;
 SELECT * INTO owner FROM directfuel.members WHERE active AND profile='Master';
 IF owner.id IS NULL THEN RAISE EXCEPTION 'Owner unavailable'; END IF;
 SELECT revision INTO rev FROM directfuel.state_revision WHERE id='main';
 before_state:=directfuel.snapshot();
 candidate:=jsonb_set(before_state,'{config,productionValidationProbe}',to_jsonb('rollback-only'::text));
 result:=public.directfuel_state_write(owner.auth_user_id,owner.email,rev,candidate,'[]'::jsonb,false);
 after_state:=directfuel.snapshot();
 IF after_state#>>'{config,productionValidationProbe}'<>'rollback-only' THEN RAISE EXCEPTION 'Write not readable'; END IF;
 IF (after_state#-'{config,productionValidationProbe}') IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'Unrelated data changed'; END IF;
 IF (result->>'version')::bigint<>rev+1 THEN RAISE EXCEPTION 'Revision mismatch'; END IF;
 BEGIN PERFORM public.directfuel_state_write(owner.auth_user_id,owner.email,rev,candidate,'[]'::jsonb,false); EXCEPTION WHEN SQLSTATE 'PT409' THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stale write accepted'; END IF;
 IF EXISTS(SELECT 1 FROM directfuel.backups b JOIN directfuel.backup_payloads p ON p.backup_id=b.id WHERE b.validated_at IS NOT NULL AND b.sha256<>encode(sha256(convert_to(p.payload::text,'UTF8')),'hex')) THEN RAISE EXCEPTION 'Backup checksum mismatch'; END IF;
 IF (SELECT provolatile FROM pg_proc WHERE oid='public.directfuel_preview_access(uuid,text)'::regprocedure)<>'v' THEN RAISE EXCEPTION 'Login RPC must allow membership row locks'; END IF;
END $test$;
