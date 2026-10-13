-- Fix legacy email escaping and accept the existing read-only profile.
DO $fix$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.directfuel_team(uuid,text,text,text,jsonb)'::regprocedure);
 d:=replace(d,chr(92)||chr(92)||'.','[.]');
 d:=replace(d,'''Operador'',''Usuário'',''Usuario''','''Operador'',''Usuário'',''Usuario'',''Consulta''');
 EXECUTE d;
END $fix$;
