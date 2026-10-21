// Shared bits of the Lugaw Delights client (replaces the Firebase SDK): talking to the API,
// timestamps, and turning values into JSON and back.

export class FirebaseError extends Error {
  constructor(code, message) { super(message || code); this.code = code; this.name = "FirebaseError"; }
}

export class Timestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
  static now() { return Timestamp.fromMillis(Date.now()); }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  isEqual(o) { return o instanceof Timestamp && o.toMillis() === this.toMillis(); }
  valueOf() { return String(this.toMillis()).padStart(16, "0"); }
  toJSON() { return { seconds: this.seconds, nanoseconds: this.nanoseconds }; }
}

// Field values that the server fills in (server time) or applies (delete, arrayUnion, increment)
export class FieldOp { constructor(json) { this.json = json; } }

// To the server: Timestamp/Date -> {__t: ms}
export function encode(v, where = "") {
  if (v === undefined) throw new FirebaseError("invalid-argument", `Unsupported field value: undefined${where ? ` (found in field ${where})` : ""}`);
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") { if (!isFinite(v)) throw new FirebaseError("invalid-argument", "Unsupported number"); return v; }
  if (v instanceof Timestamp) return { __t: v.toMillis() };
  if (v instanceof Date) return { __t: v.getTime() };
  if (v instanceof FieldOp) return v.json;
  if (Array.isArray(v)) return v.map((x, i) => encode(x, `${where}[${i}]`));
  if (typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = encode(x, where ? `${where}.${k}` : k); return o; }
  throw new FirebaseError("invalid-argument", "Unsupported field value");
}
// From the server: {__t: ms} -> Timestamp
export function decode(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(decode);
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0] === "__t") return Timestamp.fromMillis(v.__t);
  const o = {}; for (const k of keys) o[k] = decode(v[k]); return o;
}

// Where the API is: the page's own site (api/index.php), or the full address in the apps
export function apiUrl(app) {
  const base = app?.options?.apiBase || (typeof location !== "undefined" ? new URL("api/index.php", location.href).href : "http://127.0.0.1:8095/api/index.php");
  return base;
}

// One call to the API. headers: extra headers (the sign-in token)
export async function call(app, route, body, headers = {}) {
  let res;
  try {
    res = await fetch(apiUrl(app) + "?r=" + encodeURIComponent(route), {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body || {}), cache: "no-store"
    });
  } catch (e) { throw new FirebaseError(route.startsWith("auth.") ? "auth/network-request-failed" : "unavailable", "No internet connection."); }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok || data?.error) {
    const err = data?.error || { code: res.status >= 500 ? "internal" : "unavailable", message: `Server error ${res.status}` };
    throw new FirebaseError(err.code, err.message);
  }
  return data;
}

// localStorage when there is one (browsers, apps); in memory otherwise (tests)
const mem = new Map();
export const storage = {
  get(k) { try { if (typeof localStorage !== "undefined") return localStorage.getItem(k); } catch (_) {} return mem.get(k) ?? null; },
  set(k, v) { try { if (typeof localStorage !== "undefined") { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return; } } catch (_) {} v == null ? mem.delete(k) : mem.set(k, v); }
};
