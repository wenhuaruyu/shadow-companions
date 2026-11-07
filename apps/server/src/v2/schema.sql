CREATE SCHEMA IF NOT EXISTS anxian;
REVOKE ALL ON SCHEMA anxian FROM PUBLIC;
CREATE TABLE IF NOT EXISTS anxian.game_rooms (
  id CHAR(36) PRIMARY KEY,
  content_version VARCHAR(64) NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS anxian.game_players (
  room_id CHAR(36) NOT NULL,
  seat SMALLINT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  PRIMARY KEY (room_id, seat),
  CONSTRAINT unique_room_token UNIQUE (room_id, token_hash),
  CONSTRAINT fk_player_room FOREIGN KEY (room_id) REFERENCES anxian.game_rooms(id),
  CONSTRAINT valid_seat CHECK (seat IN (0, 1))
);
CREATE TABLE IF NOT EXISTS anxian.game_requests (
  scope_hash CHAR(64) NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  seat SMALLINT NOT NULL,
  PRIMARY KEY (scope_hash, request_id),
  CONSTRAINT fk_request_room FOREIGN KEY (room_id) REFERENCES anxian.game_rooms(id)
);
