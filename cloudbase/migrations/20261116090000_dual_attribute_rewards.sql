-- A cooperative card attempt awards each attribute once to each player.
ALTER TABLE anxian.resource_ledger DROP CONSTRAINT resource_ledger_pkey;
ALTER TABLE anxian.resource_ledger
  ADD PRIMARY KEY (room_id, seat, attempt_id, attribute);
