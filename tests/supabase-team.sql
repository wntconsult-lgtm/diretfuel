-- Execute after team.sql, inside a transaction that is always rolled back.
-- Reuses the owner's Auth UUID only in private, temporary fixtures; Auth itself is untouched.
SET LOCAL ROLE service_role;
DO $test$
DECLARE original directfuel.members; result jsonb; denied boolean; signature text;
BEGIN
 SELECT * INTO original FROM directfuel.members WHERE email='wnt.consult@gmail.com' AND profile='Master' AND active;
 IF original.id IS NULL THEN RAISE EXCEPTION 'Owner missing';END IF;
 result:=public.directfuel_state_read(original.auth_user_id,original.email,NULL);
 IF result#>>'{user,isOwner}'<>'true' THEN RAISE EXCEPTION 'Owner permissions changed';END IF;
 IF (public.directfuel_team(original.auth_user_id,original.email,'list')->>'version')::bigint<>(result->>'version')::bigint THEN RAISE EXCEPTION 'Team revision mismatch';END IF;
 denied:=false;
 BEGIN PERFORM public.directfuel_team(original.auth_user_id,original.email,'candidate',(SELECT record_id FROM directfuel.records WHERE collection_name='users' AND lower(payload->>'email')=original.email LIMIT 1)); EXCEPTION WHEN SQLSTATE 'PT403' THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Owner binding not protected';END IF;
 FOREACH signature IN ARRAY ARRAY['public.directfuel_team(uuid,text,text,text,jsonb)','public.directfuel_state_read(uuid,text,bigint)','public.directfuel_state_write(uuid,text,bigint,jsonb,jsonb,boolean)','public.directfuel_document(uuid,text,text,text,jsonb)','public.directfuel_preview_access(uuid,text)'] LOOP
  IF has_function_privilege('anon',signature,'EXECUTE') OR has_function_privilege('authenticated',signature,'EXECUTE') OR NOT has_function_privilege('service_role',signature,'EXECUTE') THEN RAISE EXCEPTION 'RPC exposed or service denied: %',signature;END IF;
 END LOOP;
 INSERT INTO directfuel.records(collection_name,record_id,payload,sort_order) VALUES('users','synthetic-member-test','{"id":"synthetic-member-test","email":"synthetic-member@example.test","nome":"Synthetic","perfil":"Operador","ativo":true,"permissoes":["postos"],"acoes":["postos:editar"]}',999999);
 UPDATE directfuel.members SET email='synthetic-member@example.test',profile='Usuário',permissions='[]',actions='[]' WHERE id=original.id;
 result:=public.directfuel_state_read(original.auth_user_id,'synthetic-member@example.test',NULL);
 IF result#>>'{user,isOwner}'<>'false' OR result#>>'{user,profile}'<>'Usuário' OR result#>'{user,permissions}'<>'["postos"]'::jsonb THEN RAISE EXCEPTION 'Member privileges did not come from current cadastro';END IF;
 IF public.directfuel_preview_access(original.auth_user_id,'synthetic-member@example.test')#>>'{user,isOwner}'<>'false' THEN RAISE EXCEPTION 'Preview elevates member';END IF;
 IF public.directfuel_document(original.auth_user_id,'synthetic-member@example.test','context')#>>'{user,isOwner}'<>'false' THEN RAISE EXCEPTION 'Document context elevates member';END IF;
 denied:=false;BEGIN PERFORM public.directfuel_team(original.auth_user_id,'synthetic-member@example.test','list');EXCEPTION WHEN SQLSTATE 'PT403' THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Member can administer team';END IF;
 denied:=false;BEGIN PERFORM public.directfuel_security(original.auth_user_id,'synthetic-member@example.test','list');EXCEPTION WHEN SQLSTATE 'PT403' THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Member can access backups';END IF;
 denied:=false;BEGIN PERFORM public.directfuel_document(original.auth_user_id,'synthetic-member@example.test','get','synthetic-file:pdf');EXCEPTION WHEN SQLSTATE 'PT403' THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Member can read unpermitted documents';END IF;
 UPDATE directfuel.records SET payload=jsonb_set(payload,'{ativo}','false') WHERE collection_name='users' AND record_id='synthetic-member-test';
 denied:=false;BEGIN PERFORM public.directfuel_state_read(original.auth_user_id,'synthetic-member@example.test',NULL);EXCEPTION WHEN SQLSTATE 'PT403' THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Inactive cadastro accepted';END IF;
 UPDATE directfuel.records SET payload=jsonb_set(payload,'{ativo}','true') WHERE collection_name='users' AND record_id='synthetic-member-test';
 UPDATE directfuel.members SET active=false WHERE id=original.id;
 denied:=false;BEGIN PERFORM public.directfuel_state_read(original.auth_user_id,'synthetic-member@example.test',NULL);EXCEPTION WHEN SQLSTATE 'PT403' THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Revoked member accepted';END IF;
END $test$;
