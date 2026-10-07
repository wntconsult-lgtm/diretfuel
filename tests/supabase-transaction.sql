-- Integration test for an EMPTY migration database. All fixtures are rolled back.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE owner directfuel.members; rev bigint; payload jsonb; result jsonb; bid uuid; failed boolean; corrupted jsonb;
BEGIN
 SELECT * INTO owner FROM directfuel.members WHERE active AND profile='Master' AND auth_user_id IS NOT NULL LIMIT 1;
 IF owner.id IS NULL THEN RAISE EXCEPTION 'An active owner is required'; END IF;
 SELECT revision INTO rev FROM directfuel.state_revision WHERE id='main';
 IF rev<>0 OR EXISTS(SELECT 1 FROM directfuel.records) THEN RAISE EXCEPTION 'Test requires an empty database'; END IF;
 SELECT jsonb_build_object('abastecimentos','[]'::jsonb,'medicoes','[]'::jsonb,'testRecords',jsonb_agg(jsonb_build_object('id','fixture-'||n,'description',repeat('x',4500)))) INTO payload FROM generate_series(1,2000) n;
 result:=public.directfuel_initial_import(owner.auth_user_id,owner.email,rev,payload,'[]');
 IF (result->>'version')::bigint<>rev+1 OR directfuel.snapshot()<>payload THEN RAISE EXCEPTION 'Import did not preserve the snapshot'; END IF;
 bid:=(result->>'backupId')::uuid;
 IF (public.directfuel_security(owner.auth_user_id,owner.email,'download',bid)->'state')<>payload THEN RAISE EXCEPTION 'Validated backup is different'; END IF;
 failed:=false;
 BEGIN PERFORM public.directfuel_initial_import(owner.auth_user_id,owner.email,rev+1,payload,'[]'); EXCEPTION WHEN SQLSTATE 'PT409' THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Nonempty destination was overwritten'; END IF;
 failed:=false;
 BEGIN PERFORM public.directfuel_state_write(owner.auth_user_id,owner.email,rev,payload,'[]'); EXCEPTION WHEN SQLSTATE 'PT409' THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Stale write was accepted'; END IF;
 FOR n IN 1..6 LOOP PERFORM public.directfuel_security(owner.auth_user_id,owner.email,'create_backup'); END LOOP;
 IF (SELECT count(*) FROM directfuel.backups WHERE validated_at IS NOT NULL)<>5 THEN RAISE EXCEPTION 'Retention did not keep five validated backups'; END IF;
 SELECT id INTO bid FROM directfuel.backups ORDER BY created_at DESC LIMIT 1;
 DELETE FROM directfuel.backup_payloads AS b WHERE backup_id=bid RETURNING b.payload INTO corrupted;
 INSERT INTO directfuel.backup_payloads(backup_id,payload) VALUES(bid,corrupted || '{"corrupted":true}'::jsonb);
 failed:=false;
 BEGIN PERFORM public.directfuel_security(owner.auth_user_id,owner.email,'download',bid); EXCEPTION WHEN SQLSTATE 'PT404' THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Corrupted backup was accepted'; END IF;
 PERFORM public.directfuel_document(owner.auth_user_id,owner.email,'put','NF_LAYOUT_fixture:pdf','{"path":"fixture-1.pdf","filename":"fixture.pdf","type":"application/pdf","bytes":5,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"}');
 failed:=false;
 BEGIN PERFORM public.directfuel_document(owner.auth_user_id,owner.email,'put','NF_LAYOUT_fixture:pdf','{"path":"fixture-2.pdf","filename":"fixture.pdf","type":"application/pdf","bytes":5,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"}'); EXCEPTION WHEN SQLSTATE 'PT409' THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Immutable layout replaced'; END IF;
 PERFORM public.directfuel_security(owner.auth_user_id,owner.email,'list');
END $$;
ROLLBACK;
SELECT jsonb_build_object('revision',(SELECT revision FROM directfuel.state_revision WHERE id='main'),'records',(SELECT count(*) FROM directfuel.records),'backups',(SELECT count(*) FROM directfuel.backups),'documents',(SELECT count(*) FROM directfuel.documents)) AS after_rollback;
