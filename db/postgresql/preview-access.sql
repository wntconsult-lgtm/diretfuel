-- Aplicação remota: directfuel_preview_access (projeto de testes).
-- A identidade vem de Auth /user, verificada pela Edge Function.
-- SECURITY INVOKER: clientes não têm EXECUTE nem acesso ao schema privado.
CREATE OR REPLACE FUNCTION public.directfuel_preview_access(p_user_id uuid, p_email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'user', jsonb_build_object('email', m.email, 'name', m.display_name, 'profile', m.profile),
    'revision', (SELECT revision FROM directfuel.state_revision WHERE id = 'main'),
    'collections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', c.name, 'records',
        (SELECT count(*) FROM directfuel.records r WHERE r.collection_name = c.name)) ORDER BY c.name)
      FROM directfuel.collections c
    ), '[]'::jsonb),
    'documents', (SELECT count(*) FROM directfuel.documents WHERE removed_at IS NULL),
    'backups', (SELECT count(*) FROM directfuel.backups WHERE validated_at IS NOT NULL),
    'mode', 'migration-preview'
  ) FROM directfuel.members m
  WHERE m.active AND m.profile = 'Master'
    AND m.email = lower(trim(p_email)) AND m.email = 'wnt.consult@gmail.com'
    AND m.auth_user_id = p_user_id;
$$;
REVOKE ALL ON FUNCTION public.directfuel_preview_access(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.directfuel_preview_access(uuid, text) TO service_role;
COMMENT ON FUNCTION public.directfuel_preview_access(uuid, text) IS
  'Resumo privado de testes. Somente service_role após validar Auth; não retorna registros fiscais ou permite gravações.';
