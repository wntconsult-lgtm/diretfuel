-- Cache reconstruível e cota local. Nenhuma chave de serviço é armazenada no banco.
CREATE TABLE directfuel.geo_cache (
 cache_key text PRIMARY KEY CHECK(cache_key ~ '^[a-f0-9]{64}$'),kind text NOT NULL CHECK(kind IN('route','geocode')),
 payload jsonb CHECK(payload IS NULL OR jsonb_typeof(payload)='object' AND octet_length(payload::text)<=8192),
 expires_at timestamptz,lease_token uuid,lease_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE directfuel.geo_usage (
 day date PRIMARY KEY,requests integer NOT NULL DEFAULT 0 CHECK(requests BETWEEN 0 AND 100),last_request timestamptz
);
ALTER TABLE directfuel.geo_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE directfuel.geo_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON directfuel.geo_cache,directfuel.geo_usage FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON directfuel.geo_cache TO service_role;
GRANT SELECT,INSERT,UPDATE ON directfuel.geo_usage TO service_role;
CREATE FUNCTION public.directfuel_geo_cache(p_user_id uuid,p_email text,p_action text,p_key text DEFAULT NULL,p_kind text DEFAULT NULL,p_payload jsonb DEFAULT NULL,p_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m directfuel.members; item directfuel.geo_cache; usage directfuel.geo_usage; today date:=(clock_timestamp() AT TIME ZONE 'UTC')::date; token uuid;
BEGIN
 m:=directfuel.require_member(p_user_id,p_email);
 IF NOT directfuel.member_can(m,'analysis_geo') THEN RAISE SQLSTATE 'PT403' USING MESSAGE='Acesso geográfico não autorizado.';END IF;
 IF p_action='usage' THEN RETURN jsonb_build_object('requests',COALESCE((SELECT requests FROM directfuel.geo_usage WHERE day=today),0),'dailyLimit',100,'day',today);END IF;
 IF p_action='list' THEN RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('key',cache_key,'payload',payload)) FROM directfuel.geo_cache WHERE kind='route' AND payload IS NOT NULL AND expires_at>now()),'[]');END IF;
 IF p_action='invalidate_errors' THEN
  IF NOT directfuel.member_can(m,'analysis_geo','editar') THEN RAISE SQLSTATE 'PT403' USING MESSAGE='Seu acesso não permite recalcular rotas.';END IF;
  UPDATE directfuel.geo_cache SET expires_at=now() WHERE kind='route' AND payload->>'status'='Erro' AND COALESCE(lease_until,'-infinity')<now();RETURN '{}';
 END IF;
 IF p_key IS NULL OR p_key !~ '^[a-f0-9]{64}$' OR p_kind IS NULL OR p_kind NOT IN('route','geocode') THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Consulta geográfica inválida.';END IF;
 IF p_action='get' THEN RETURN COALESCE((SELECT jsonb_build_object('payload',payload) FROM directfuel.geo_cache WHERE cache_key=p_key AND kind=p_kind AND payload IS NOT NULL AND expires_at>now()),'{}');END IF;
 IF NOT directfuel.member_can(m,'analysis_geo','editar') THEN RAISE SQLSTATE 'PT403' USING MESSAGE='Seu acesso não permite consultar o provedor.';END IF;
 IF p_action='reserve' THEN
  INSERT INTO directfuel.geo_cache(cache_key,kind) VALUES(p_key,p_kind) ON CONFLICT DO NOTHING;
  SELECT * INTO item FROM directfuel.geo_cache WHERE cache_key=p_key FOR UPDATE;
  IF item.kind<>p_kind THEN RAISE SQLSTATE 'PT409' USING MESSAGE='A consulta mudou.';END IF;
  IF item.payload IS NOT NULL AND item.expires_at>now() THEN RETURN jsonb_build_object('payload',item.payload);END IF;
  IF item.lease_until>clock_timestamp() THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Esta consulta já está em andamento. Aguarde para continuar.';END IF;
  INSERT INTO directfuel.geo_usage(day) VALUES(today) ON CONFLICT DO NOTHING;
  SELECT * INTO usage FROM directfuel.geo_usage WHERE day=today FOR UPDATE;
  IF usage.requests>=100 THEN RAISE SQLSTATE 'PT429' USING MESSAGE='Limite local de 100 consultas diárias atingido. Continue no próximo dia UTC.';END IF;
  IF usage.last_request>clock_timestamp()-interval '350 milliseconds' THEN RAISE SQLSTATE 'PT429' USING MESSAGE='Aguarde um instante antes da próxima consulta de mapas.';END IF;
  UPDATE directfuel.geo_usage SET requests=requests+1,last_request=clock_timestamp() WHERE day=today;
  token:=gen_random_uuid();UPDATE directfuel.geo_cache SET lease_token=token,lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() WHERE cache_key=p_key;
  -- Caches expirados são reconstruíveis; a limpeza nunca alcança registros operacionais.
  DELETE FROM directfuel.geo_cache WHERE cache_key<>p_key AND COALESCE(expires_at,updated_at)<now()-interval '1 day' AND COALESCE(lease_until,'-infinity')<now();
  RETURN jsonb_build_object('token',token);
 ELSIF p_action='invalidate' THEN
  UPDATE directfuel.geo_cache SET expires_at=now() WHERE cache_key=p_key AND kind=p_kind AND payload->>'status'='Erro' AND COALESCE(lease_until,'-infinity')<now();RETURN '{}';
 ELSIF p_action='put' THEN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>8192 THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Resultado geográfico inválido.';END IF;
  UPDATE directfuel.geo_cache SET payload=p_payload,expires_at=clock_timestamp()+CASE WHEN p_kind='route' THEN interval '30 days' ELSE interval '90 days' END,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE cache_key=p_key AND kind=p_kind AND lease_token=p_token AND lease_until>clock_timestamp();
  IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='A reserva da consulta expirou. Tente novamente.';END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='release' THEN UPDATE directfuel.geo_cache SET lease_token=NULL,lease_until=NULL WHERE cache_key=p_key AND lease_token=p_token;RETURN '{}';
 END IF;
 RAISE SQLSTATE 'PT400' USING MESSAGE='Ação geográfica inválida.';
END $$;
REVOKE ALL ON FUNCTION public.directfuel_geo_cache(uuid,text,text,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.directfuel_geo_cache(uuid,text,text,text,text,jsonb,uuid) TO service_role;
