BEGIN;
-- Run after schema.sql. Public wrappers are gateway entry points.
-- Claims must be injected by the authenticated CloudBase gateway.
CREATE OR REPLACE FUNCTION anxian.room_snapshot(p_room text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_room anxian.game_rooms%ROWTYPE;
  v_seat smallint;
  v_players jsonb;
BEGIN
  SELECT seat INTO v_seat FROM anxian.game_players
    WHERE room_id=p_room AND token_hash=p_token_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CREDENTIAL'; END IF;
  SELECT * INTO STRICT v_room FROM anxian.game_rooms WHERE id=p_room;
  SELECT jsonb_agg(jsonb_build_object(
    'name', CASE seat WHEN 0 THEN '林舟' ELSE '顾宁' END,
    'int',5,'str',5,'ready',false,'instruction',false,'tutorial',false,
    'entered',false,'read',false,'continued',false,'online',false,
    'event',null,'investment',null) ORDER BY seat)
    INTO v_players FROM anxian.game_players WHERE room_id=p_room;
  RETURN jsonb_build_object('id',trim(v_room.id),'version',v_room.version,
    'contentVersion',v_room.content_version,'rulesVersion','mvp-rules-1',
    'phase','lobby','chapter',0,'ended',false,'outcome',null,'paused',false,
    'pause',null,'requirements',jsonb_build_object('int',5,'str',5),
    'me',v_seat,'players',v_players,'attempt',null,'questions',null,
    'investmentDraft',null,'records','[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION anxian.room_snapshot(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.anxian_room_enter(
  p_request_id text, p_token_hash text, p_scope text, p_payload text,
  p_content_version text, p_room text, p_joining boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_receipt anxian.game_requests%ROWTYPE;
  v_room anxian.game_rooms%ROWTYPE;
  v_id text;
  v_seat smallint;
  v_now bigint := floor(extract(epoch FROM clock_timestamp())*1000);
  v_replayed boolean := false;
BEGIN
  IF (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')
      IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'RPC_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9_-]{8,128}$'
    OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_scope IS NULL OR p_scope !~ '^[0-9a-f]{64}$'
    OR p_payload IS NULL OR p_payload !~ '^[0-9a-f]{64}$'
    OR p_joining IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_joining THEN
    IF p_room IS NULL OR p_room !~ '^[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  ELSIF p_content_version IS DISTINCT FROM 'mvp-two-sites-1' THEN
    RAISE EXCEPTION 'CONTENT_VERSION_UNSUPPORTED';
  END IF;
  -- The transaction lock serializes the same idempotency key before any writes.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_scope||':'||p_request_id,0));
  SELECT * INTO v_receipt FROM anxian.game_requests
    WHERE scope_hash=p_scope AND request_id=p_request_id;
  IF FOUND THEN
    IF v_receipt.payload_hash <> p_payload THEN RAISE EXCEPTION 'REQUEST_ID_CONFLICT'; END IF;
    v_id := trim(v_receipt.room_id);
    v_seat := v_receipt.seat;
    v_replayed := true;
    PERFORM id FROM anxian.game_rooms WHERE id=v_id FOR UPDATE;
  ELSE
    IF p_joining THEN
      v_id := p_room;
    ELSE
      v_id := gen_random_uuid()::text;
      INSERT INTO anxian.game_rooms(id,content_version,created_at)
        VALUES(v_id,p_content_version,v_now);
    END IF;
    SELECT * INTO v_room FROM anxian.game_rooms WHERE id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
    IF EXISTS(SELECT 1 FROM anxian.game_players WHERE room_id=v_id AND token_hash=p_token_hash)
      THEN RAISE EXCEPTION 'ACTION_ALREADY_DONE'; END IF;
    SELECT count(*)::smallint INTO v_seat FROM anxian.game_players WHERE room_id=v_id;
    IF v_seat>=2 THEN RAISE EXCEPTION 'ROOM_FULL'; END IF;
    IF p_joining AND v_now-v_room.created_at>=900000 THEN RAISE EXCEPTION 'INVITE_EXPIRED'; END IF;
    INSERT INTO anxian.game_players(room_id,seat,token_hash) VALUES(v_id,v_seat,p_token_hash);
    UPDATE anxian.game_rooms SET version=version+1 WHERE id=v_id;
    INSERT INTO anxian.game_requests(scope_hash,request_id,payload_hash,room_id,seat)
      VALUES(p_scope,p_request_id,p_payload,v_id,v_seat);
  END IF;
  RETURN jsonb_build_object('id',v_id,'seat',v_seat,'replayed',v_replayed,
    'snapshot',anxian.room_snapshot(v_id,p_token_hash));
END;
$$;

CREATE OR REPLACE FUNCTION public.anxian_room_state(p_room text,p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')
      IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'RPC_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'INVALID_CREDENTIAL'; END IF;
  PERFORM id FROM anxian.game_rooms WHERE id=p_room FOR SHARE;
  RETURN anxian.room_snapshot(p_room,p_token_hash);
END;
$$;
REVOKE ALL ON FUNCTION public.anxian_room_enter(text,text,text,text,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anxian_room_state(text,text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.anxian_room_enter(text,text,text,text,text,text,boolean) TO service_role;
    GRANT EXECUTE ON FUNCTION public.anxian_room_state(text,text) TO service_role;
  END IF;
END;
$$;

COMMIT;
