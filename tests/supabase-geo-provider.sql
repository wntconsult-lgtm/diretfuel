-- Run after geo-provider.sql in the same BEGIN/ROLLBACK transaction.
SET LOCAL ROLE service_role;
DO $test$
DECLARE owner directfuel.members; result jsonb; token uuid; failed boolean; k text:=repeat('a',64); today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 SELECT * INTO owner FROM directfuel.members WHERE email='wnt.consult@gmail.com' AND profile='Master' AND active;
 IF has_function_privilege('anon','public.directfuel_geo_cache(uuid,text,text,text,text,jsonb,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.directfuel_geo_cache(uuid,text,text,text,text,jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Cache RPC exposed';END IF;
 IF has_table_privilege('anon','directfuel.geo_cache','SELECT') OR has_table_privilege('authenticated','directfuel.geo_usage','UPDATE') THEN RAISE EXCEPTION 'Private cache exposed';END IF;
 result:=public.directfuel_geo_cache(owner.auth_user_id,owner.email,'reserve',k,'route');token:=(result->>'token')::uuid;
 IF token IS NULL THEN RAISE EXCEPTION 'No reservation';END IF;
 failed:=false;BEGIN PERFORM public.directfuel_geo_cache(owner.auth_user_id,owner.email,'reserve',k,'route');EXCEPTION WHEN SQLSTATE 'PT409' THEN failed:=true;END;
 IF NOT failed THEN RAISE EXCEPTION 'Concurrent provider request allowed';END IF;
 failed:=false;BEGIN PERFORM public.directfuel_geo_cache(owner.auth_user_id,owner.email,'put',k,'route','{"status":"Calculada","distance_km":2}',gen_random_uuid());EXCEPTION WHEN SQLSTATE 'PT409' THEN failed:=true;END;
 IF NOT failed THEN RAISE EXCEPTION 'Invalid lease accepted';END IF;
 PERFORM public.directfuel_geo_cache(owner.auth_user_id,owner.email,'put',k,'route','{"status":"Calculada","distance_km":2}',token);
 result:=public.directfuel_geo_cache(owner.auth_user_id,owner.email,'reserve',k,'route');
 IF result#>>'{payload,status}'<>'Calculada' OR (SELECT requests FROM directfuel.geo_usage WHERE day=today)<>1 THEN RAISE EXCEPTION 'Cache hit spent quota';END IF;
 UPDATE directfuel.geo_usage SET last_request=clock_timestamp()+interval '5 seconds' WHERE day=today;
 failed:=false;BEGIN PERFORM public.directfuel_geo_cache(owner.auth_user_id,owner.email,'reserve',repeat('b',64),'route');EXCEPTION WHEN SQLSTATE 'PT429' THEN failed:=true;END;
 IF NOT failed THEN RAISE EXCEPTION 'Global rate limit failed';END IF;
 UPDATE directfuel.geo_usage SET requests=100,last_request=clock_timestamp()-interval '10 seconds' WHERE day=today;
 failed:=false;BEGIN PERFORM public.directfuel_geo_cache(owner.auth_user_id,owner.email,'reserve',repeat('c',64),'geocode');EXCEPTION WHEN SQLSTATE 'PT429' THEN failed:=true;END;
 IF NOT failed THEN RAISE EXCEPTION 'Daily quota exceeded';END IF;
 UPDATE directfuel.geo_cache SET payload='{"status":"Erro"}' WHERE cache_key=k;
 PERFORM public.directfuel_geo_cache(owner.auth_user_id,owner.email,'invalidate_errors');
 IF jsonb_array_length(public.directfuel_geo_cache(owner.auth_user_id,owner.email,'list'))<>0 THEN RAISE EXCEPTION 'Error retry failed';END IF;
END $test$;
