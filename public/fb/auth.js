// Sign-in, with the same functions as Firebase Authentication. The token is kept per app name
// in this browser, so the customer, seller, rider and owner pages each have their own sign-in.
import { call, storage, FirebaseError } from "./core.js";

const auths = new Map();
class Auth {
  constructor(app) {
    this.app = app; this.currentUser = null; this._token = null; this._subs = new Set(); this._ready = false;
    this._key = "lugaw-auth:" + app.name;
    this._token = storage.get(this._key);
    this._readyP = (async () => {
      if (this._token) {
        try { const r = await call(app, "auth.me", {}, { "X-Lugaw-Token": this._token }); this._setUser(r.user, r.user ? this._token : null, false); }
        catch (e) { if (e.code === "unavailable" || e.code === "auth/network-request-failed") { const c = storage.get(this._key + ":user"); if (c) this.currentUser = makeUser(this, JSON.parse(c)); } else this._setUser(null, null, false); }
      }
      this._ready = true; this._emit();
    })();
  }
  _headers() { return this._token ? { "X-Lugaw-Token": this._token } : {}; }
  _setUser(u, token, emit = true) {
    this._token = u ? token : null; this.currentUser = u ? makeUser(this, u) : null;
    storage.set(this._key, this._token); storage.set(this._key + ":user", u ? JSON.stringify(u) : null);
    if (emit) this._emit();
  }
  _emit() { if (!this._ready) return; for (const f of this._subs) { try { f(this.currentUser); } catch (e) { console.error(e); } } }
}
function makeUser(auth, u) {
  return { uid: u.uid, email: u.email || null, isAnonymous: !!u.isAnonymous, providerId: u.provider,
    getIdToken: async () => auth._token, reload: async () => {} };
}

export function getAuth(app) { if (!auths.has(app)) auths.set(app, new Auth(app)); return auths.get(app); }
export function connectAuthEmulator() {}

export function onAuthStateChanged(auth, cb) {
  auth._subs.add(cb);
  if (auth._ready) queueMicrotask(() => { if (auth._subs.has(cb)) cb(auth.currentUser); });
  return () => auth._subs.delete(cb);
}
async function signIn(auth, route, body) {
  const r = await call(auth.app, route, body);
  auth._setUser(r, r.token);
  return { user: auth.currentUser };
}
export const signInWithEmailAndPassword = (auth, email, password) => signIn(auth, "auth.login", { email, password });
export const createUserWithEmailAndPassword = (auth, email, password) => signIn(auth, "auth.signup", { email, password });
export const signInAnonymously = auth => signIn(auth, "auth.anon", {});
export async function signOut(auth) {
  const h = auth._headers(); auth._setUser(null, null);
  try { await call(auth.app, "auth.logout", {}, h); } catch (_) {}
}
export async function sendPasswordResetEmail(auth, email) { await call(auth.app, "auth.reset", { email }); }
export const EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
export async function reauthenticateWithCredential(user, cred) {
  const auth = [...auths.values()].find(a => a.currentUser === user) || [...auths.values()].find(a => a.currentUser?.uid === user?.uid);
  if (!auth) throw new FirebaseError("auth/requires-recent-login", "Please sign in again.");
  await call(auth.app, "auth.reauth", { password: cred.password }, auth._headers());
  return { user };
}
// Not in Firebase: the owner sets a staff member's password (the server checks it's the owner)
export async function setPasswordFor(auth, uid, password) { await call(auth.app, "auth.setPassword", { uid, password }, auth._headers()); }
