CREATE TABLE anxian.resource_ledger (
  room_id char(36) NOT NULL REFERENCES anxian.game_rooms(id),
  seat smallint NOT NULL CHECK (seat IN (0,1)),
  attempt_id uuid NOT NULL,
  attribute text NOT NULL CHECK (attribute IN ('int','str')),
  amount integer NOT NULL CHECK (amount BETWEEN 0 AND 10),
  PRIMARY KEY(room_id,seat,attempt_id)
);
REVOKE ALL ON anxian.resource_ledger FROM PUBLIC;

CREATE FUNCTION public.anxian_game_reward_commit(p_room text,p_token_hash text,p_version bigint,
  p_state jsonb,p_rewards jsonb,p_request_id text DEFAULT NULL,p_payload text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_version bigint;
  v_seat smallint;
  v_receipt anxian.game_actions%ROWTYPE;
  v_reward jsonb;
BEGIN
  IF (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') IS DISTINCT FROM 'service_role'
    THEN RAISE EXCEPTION 'RPC_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT version INTO v_version FROM anxian.game_rooms WHERE id=p_room FOR UPDATE;
  SELECT seat INTO v_seat FROM anxian.game_players WHERE room_id=p_room AND token_hash=p_token_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CREDENTIAL'; END IF;
  IF p_request_id IS NOT NULL THEN
    IF p_request_id !~ '^[A-Za-z0-9_-]{8,128}$' OR p_payload IS NULL OR p_payload !~ '^[0-9a-f]{64}$'
      THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    SELECT * INTO v_receipt FROM anxian.game_actions
      WHERE room_id=p_room AND seat=v_seat AND request_id=p_request_id;
    IF FOUND THEN
      IF v_receipt.payload_hash<>p_payload THEN RAISE EXCEPTION 'REQUEST_ID_CONFLICT'; END IF;
      RETURN jsonb_build_object('replayed',true,'appliedVersion',v_receipt.applied_version);
    END IF;
  END IF;
  IF v_version IS DISTINCT FROM p_version THEN RETURN jsonb_build_object('conflict',true); END IF;
  IF jsonb_typeof(p_state) IS DISTINCT FROM 'object' OR jsonb_typeof(p_rewards) IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOR v_reward IN SELECT value FROM jsonb_array_elements(p_rewards) LOOP
    INSERT INTO anxian.resource_ledger(room_id,seat,attempt_id,attribute,amount)
      VALUES(p_room,(v_reward->>'seat')::smallint,(v_reward->>'attemptId')::uuid,
        v_reward->>'attribute',(v_reward->>'amount')::integer);
  END LOOP;
  UPDATE anxian.game_rooms SET game_state=p_state,version=version+1 WHERE id=p_room;
  IF p_request_id IS NOT NULL THEN
    INSERT INTO anxian.game_actions VALUES(p_room,v_seat,p_request_id,p_payload,v_version+1);
  END IF;
  RETURN jsonb_build_object('replayed',false,'appliedVersion',v_version+1);
END;
$$;

REVOKE ALL ON FUNCTION public.anxian_game_reward_commit(text,text,bigint,jsonb,jsonb,text,text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN

    GRANT EXECUTE ON FUNCTION public.anxian_game_reward_commit(text,text,bigint,jsonb,jsonb,text,text) TO service_role;
  END IF;
END $$;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 REVOKE ALL ON FUNCTION public.anxian_game_reward_commit(text,text,bigint,jsonb,jsonb,text,text) FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 REVOKE ALL ON FUNCTION public.anxian_game_reward_commit(text,text,bigint,jsonb,jsonb,text,text) FROM authenticated;
 END IF;
END $$;
