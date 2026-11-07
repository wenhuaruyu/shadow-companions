-- CloudBase default privileges grant EXECUTE directly to these application roles.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.anxian_game_load(text,text,text) FROM anon;
    REVOKE ALL ON FUNCTION public.anxian_game_commit(text,text,bigint,jsonb,text,text) FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.anxian_game_load(text,text,text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.anxian_game_commit(text,text,bigint,jsonb,text,text) FROM authenticated;
  END IF;
END $$;
