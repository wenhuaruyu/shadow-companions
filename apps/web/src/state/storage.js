export const SESSION_KEY = "anxian.session.v2";

export function readStored(storage, key, fallback = null) {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function readSession(storage) {
  const session = readStored(storage, SESSION_KEY);
  if (
    !session ||
    typeof session.id !== "string" ||
    typeof session.token !== "string"
  )
    return null;
  return session;
}

export function saveSession(storage, session) {
  if (session) storage.setItem(SESSION_KEY, JSON.stringify(session));
  else storage.removeItem(SESSION_KEY);
}

export function newRecoverySecret(cryptoProvider = globalThis.crypto) {
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function newRequestId(cryptoProvider = globalThis.crypto) {
  if (typeof cryptoProvider.randomUUID === "function")
    return cryptoProvider.randomUUID();
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
