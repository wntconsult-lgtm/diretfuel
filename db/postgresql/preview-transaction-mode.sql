-- Remote migration: directfuel_preview_access_transaction_mode.
-- Keep membership locking and existing EXECUTE grants; POST must allow row locks.
ALTER FUNCTION public.directfuel_preview_access(uuid,text) VOLATILE;
NOTIFY pgrst, 'reload schema';
