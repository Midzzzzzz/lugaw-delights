// The database, with the same functions as Firebase's Firestore (doc, setDoc, onSnapshot, …).
// Saves go to the Lugaw Delights API, which checks them against firestore.rules. Live updates:
// every page asks the server every few seconds what changed since it last asked.
import { call, encode, decode, FirebaseError, Timestamp, FieldOp } from "./core.js";
import { getAuth } from "./auth.js";
export { Timestamp };

const dbs = new Map();
class Db {
  constructor(app, opts = {}) {
    this.app = app; this.type = "firestore"; this._extra = opts.headers || null;
    this._auth = opts.headers ? null : getAuth(app);
    this._ls = new Map(); this._since = 0; this._timer = null; this._busy = false; this._again = false; this._lastToken = undefined;
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (!document.hidden) this._kick(0); });
  }
  _headers() { return this._extra || this._auth?._headers() || {}; }
  _call(route, body) { return call(this.app, route, body, this._headers()); }
  // ---------- live updates ----------
  _kick(ms = 30) { clearTimeout(this._timer); if (!this._ls.size) return; this._timer = setTimeout(() => this._poll(), ms); this._timer.unref?.(); }
  async _poll() {
    if (this._busy) { this._again = true; return; }
    this._busy = true;
    const token = JSON.stringify(this._headers());
    if (token !== this._lastToken) { this._lastToken = token; this._since = 0; for (const l of this._ls.values()) l.known = false; }
    const listens = [], known = [];
    for (const [k, l] of this._ls) { listens.push(l.spec); if (l.known) known.push(k); }
    try {
      const r = await this._call("poll", { since: this._since, listens, known });
      this._since = r.ver;
      for (const [k, res] of Object.entries(r.res)) { const l = this._ls.get(k); if (l) l.update(res); }
    } catch (e) {
      // offline or server trouble: keep the last data and try again
    } finally {
      this._busy = false;
      const hidden = typeof document !== "undefined" && document.hidden;
      this._kick(this._again ? 0 : (hidden ? 15000 : 3000)); this._again = false;
    }
  }
}
let seq = 0;

export function getFirestore(app) { if (!dbs.has(app)) dbs.set(app, new Db(app)); return dbs.get(app); }
export function connectFirestoreEmulator() {}
// For the automated tests: a database that acts as a given user (or with the rules switched off)
export function _testDb(app, headers) { return new Db(app, { headers }); }

// ---------- references ----------
const autoId = () => { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; const r = new Uint8Array(20); crypto.getRandomValues(r); for (const x of r) s += a[x % 62]; return s; };
class CollRef { constructor(db, path) { this.type = "collection"; this.firestore = db; this.path = path; this.id = path.split("/").pop(); } }
class DocRef {
  constructor(db, path) { this.type = "document"; this.firestore = db; this.path = path; const p = path.split("/"); this.id = p[p.length - 1]; this.parent = new CollRef(db, p.slice(0, -1).join("/")); }
}
class Query { constructor(coll, where = [], order = [], lim = null) { this.type = "query"; this.firestore = coll.firestore; this._coll = coll; this._where = where; this._order = order; this._limit = lim; } }
const dbOf = x => (x instanceof Db ? x : x.firestore);
export function collection(parent, ...segs) {
  const db = dbOf(parent), base = parent instanceof Db ? "" : parent.path + "/";
  return new CollRef(db, base + segs.join("/"));
}
export function doc(parent, ...segs) {
  const db = dbOf(parent);
  if (parent instanceof CollRef) return new DocRef(db, parent.path + "/" + (segs.length ? segs.join("/") : autoId()));
  return new DocRef(db, segs.join("/"));
}
export const where = (field, op, value) => ({ kind: "where", field, op, value });
export const orderBy = (field, dir = "asc") => ({ kind: "order", field, dir });
export const limit = n => ({ kind: "limit", n });
export function query(base, ...cs) {
  const q = base instanceof Query ? new Query(base._coll, [...base._where], [...base._order], base._limit) : new Query(base);
  for (const c of cs) {
    if (c.kind === "where") q._where.push([c.field, c.op, encode(c.value)]);
    else if (c.kind === "order") q._order.push([c.field, c.dir]);
    else if (c.kind === "limit") q._limit = c.n;
  }
  return q;
}
const qSpec = q => q instanceof CollRef ? { coll: q.path } : { coll: q._coll.path, where: q._where, order: q._order, ...(q._limit != null ? { limit: q._limit } : {}) };

// ---------- snapshots ----------
class DocSnap {
  constructor(ref, raw, exists) { this.ref = ref; this.id = ref.id; this._raw = raw; this._exists = exists; this.metadata = { hasPendingWrites: false, fromCache: false }; }
  exists() { return this._exists; }
  data() { return this._exists ? decode(this._raw) : undefined; }
  get(f) { return this.data()?.[f]; }
}
class QuerySnap {
  constructor(q, docs) { this.query = q; this.docs = docs; this.size = docs.length; this.empty = !docs.length; this.metadata = { hasPendingWrites: false, fromCache: false }; }
  forEach(f) { this.docs.forEach(f); }
  docChanges() { return this.docs.map((d, i) => ({ type: "added", doc: d, oldIndex: -1, newIndex: i })); }
}
const collOf = q => (q instanceof CollRef ? q : q._coll);

export async function getDoc(ref) {
  const r = await dbOf(ref)._call("get", { path: ref.path });
  return new DocSnap(ref, r.data, r.exists);
}
export const getDocFromServer = getDoc;
export async function getDocs(q) {
  const db = dbOf(q), r = await db._call("query", { q: qSpec(q) });
  return new QuerySnap(q, r.docs.map(d => new DocSnap(new DocRef(db, collOf(q).path + "/" + d.id), d.data, true)));
}
export const getDocsFromServer = getDocs;

// ---------- writing ----------
export const serverTimestamp = () => new FieldOp({ __st: 1 });
export const deleteField = () => new FieldOp({ __op: "del" });
export const arrayUnion = (...v) => new FieldOp({ __op: "union", v: encode(v) });
export const arrayRemove = (...v) => new FieldOp({ __op: "remove", v: encode(v) });
export const increment = n => new FieldOp({ __op: "inc", v: n });

const W = {
  set: (ref, data, opts) => ({ op: "set", path: ref.path, data: encode(data), merge: !!opts?.merge }),
  update: (ref, data) => ({ op: "update", path: ref.path, data: encode(data) }),
  del: ref => ({ op: "delete", path: ref.path })
};
async function commit(db, writes) {
  const r = await db._call("commit", { writes });
  db._kick(0); // show the change straight away
  return r;
}
export async function setDoc(ref, data, opts) { await commit(dbOf(ref), [W.set(ref, data, opts)]); }
export async function updateDoc(ref, data) { await commit(dbOf(ref), [W.update(ref, data)]); }
export async function deleteDoc(ref) { await commit(dbOf(ref), [W.del(ref)]); }
export async function addDoc(coll, data) { const ref = doc(coll); await setDoc(ref, data); return ref; }
export function writeBatch(db) {
  const ws = [];
  const b = {
    set(ref, data, opts) { ws.push(W.set(ref, data, opts)); return b; },
    update(ref, data) { ws.push(W.update(ref, data)); return b; },
    delete(ref) { ws.push(W.del(ref)); return b; },
    async commit() { if (ws.length) await commit(db, ws); }
  };
  return b;
}
// A transaction: reads remember each document's version; the writes are only saved if none of
// them changed meanwhile, otherwise the whole thing runs again (up to 5 times).
export async function runTransaction(db, fn) {
  for (let attempt = 0; ; attempt++) {
    const vers = new Map(), ws = [];
    const tx = {
      async get(ref) { const r = await db._call("get", { path: ref.path }); vers.set(ref.path, r.exists ? r.ver : 0); return new DocSnap(ref, r.data, r.exists); },
      set(ref, data, opts) { ws.push(W.set(ref, data, opts)); return tx; },
      update(ref, data) { ws.push(W.update(ref, data)); return tx; },
      delete(ref) { ws.push(W.del(ref)); return tx; }
    };
    const result = await fn(tx);
    const writes = ws.map(w => vers.has(w.path) ? { ...w, ifVer: vers.get(w.path) } : w);
    try { if (ws.length) await commit(db, writes); return result; }
    catch (e) { if (e.code !== "aborted" || attempt >= 4) throw e; }
  }
}

// ---------- live updates ----------
// onSnapshot(docRef | query, next, error): calls next with the data now and after every change.
export function onSnapshot(target, next, error) {
  if (typeof next === "object" && next) ({ next, error } = next);
  const db = dbOf(target), k = "l" + (++seq);
  const isDoc = target instanceof DocRef;
  const l = { known: false, sig: null, cache: new Map(),
    spec: isDoc ? { k, doc: target.path } : { k, q: qSpec(target) },
    update(res) {
      if (res.error) { db._ls.delete(k); error?.(new FirebaseError(res.error, res.message)); return; }
      l.known = true;
      let snap, sig;
      if (isDoc) { snap = new DocSnap(target, res.data, res.exists); sig = JSON.stringify([res.exists, res.data ?? null]); }
      else {
        for (const [id, d] of Object.entries(res.docs)) l.cache.set(id, d);
        for (const id of [...l.cache.keys()]) if (!res.ids.includes(id)) l.cache.delete(id);
        const coll = collOf(target).path;
        snap = new QuerySnap(target, res.ids.map(id => new DocSnap(new DocRef(db, coll + "/" + id), l.cache.get(id), true)));
        sig = JSON.stringify(res.ids.map(id => [id, l.cache.get(id)]));
      }
      if (sig === l.sig) return;
      l.sig = sig;
      try { next(snap); } catch (e) { console.error(e); }
    } };
  db._ls.set(k, l);
  db._kick(0);
  return () => { db._ls.delete(k); };
}
