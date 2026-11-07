export function applySnapshot(
  current,
  response,
  receivedAt = performance.now(),
) {
  const next = response.snapshot;
  if (!next) return current;
  if (current && next.id === current.id && next.version < current.version)
    return current;
  return { ...next, receivedAt };
}

export function attemptElapsed(snapshot, now = performance.now()) {
  const attempt = snapshot?.attempt;
  if (!attempt) return 0;
  if (attempt.done || snapshot.paused) return attempt.elapsed;
  return Math.min(
    attempt.duration,
    attempt.elapsed + Math.max(0, now - snapshot.receivedAt),
  );
}
