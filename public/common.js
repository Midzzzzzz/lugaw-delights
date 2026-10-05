// Shared setup and helpers for all three pages. You don't need to edit this file.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, SHOP, MENU, DELIVERY_ZONES } from "./config.js";

export { SHOP, MENU, DELIVERY_ZONES };

// Test mode: on localhost with no Firebase config pasted in, talk to the local
// Firebase emulators instead (see "Testing on your computer" in the setup guide).
const hasKeys = !String(firebaseConfig.apiKey).startsWith("PASTE");
export const testMode = !hasKeys && ["localhost", "127.0.0.1"].includes(location.hostname);
export const isConfigured = hasKeys || testMode;
const cfg = testMode
  ? { apiKey: "demo-key", authDomain: "demo-lugaw.firebaseapp.com", projectId: "demo-lugaw", appId: "demo" }
  : firebaseConfig;

// Each kind of page keeps its own sign-in (<meta name="app-role">): customer,
// rider, seller and owner. Signing in on one never signs you in on another, and
// staff signing in on a phone doesn't lose that phone's customer orders.
const role = document.querySelector('meta[name="app-role"]')?.content;
export const app = isConfigured ? initializeApp(cfg, role || "[DEFAULT]") : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
if (testMode) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

export const ITEMS = Object.create(null);
MENU.forEach(c => c.items.forEach(([id, name, price, inc, best]) => {
  ITEMS[id] = { id, name, price, inc: inc || "", best: !!best, cat: c.id, box: !!c.box };
}));
export const MAX_LINES = 20, MAX_QTY = 99; // also enforced in firestore.rules

export const peso = n => "₱" + Number(n || 0).toLocaleString("en-PH");
export const esc = s => String(s ?? "").replace(/[&<>"']/g, ch =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// Order status flow
//  Delivery: new → preparing → ready (waiting for rider) → assigned → picked_up → delivered
//  Pickup:   new → preparing → ready_pickup → completed
//  Dine-in:  preparing → completed (recorded by the shop at the counter)
//  Any time before delivery: cancelled
export const STATUS = {
  new:          { label: "Order received",        tone: "new" },
  preparing:    { label: "Preparing",             tone: "work" },
  ready:        { label: "Waiting for a rider",   tone: "work" },
  ready_pickup: { label: "Ready for pickup",      tone: "go" },
  assigned:     { label: "Rider on the way to shop", tone: "go" },
  picked_up:    { label: "On the way to you",     tone: "go" },
  delivered:    { label: "Delivered",             tone: "done" },
  completed:    { label: "Picked up",             tone: "done" },
  cancelled:    { label: "Cancelled",             tone: "off" }
};
// Delivery orders find a rider first; the store cooks once a rider has accepted.
export const FLOW = {
  Delivery: ["new", "assigned", "preparing", "ready", "picked_up", "delivered"],
  Pickup: ["new", "preparing", "ready_pickup", "completed"],
  "Dine-in": ["preparing", "completed"]
};
const DELIVERY_LABELS = { new: "Finding a rider", assigned: "Rider found", preparing: "Preparing", ready: "Ready for the rider" };
// A step's name for an order type (used for the customer's tracking steps)
export function stepLabel(mode, s) {
  return (mode === "Delivery" && DELIVERY_LABELS[s]) || STATUS[s]?.label || s;
}
export function statusLabel(o) {
  if (o.mode === "Dine-in" && o.status === "completed") return "Served";
  // a rider gave the order back after the store started cooking
  if (o.mode === "Delivery" && !o.riderUid && ["preparing", "ready"].includes(o.status)) return stepLabel(o.mode, o.status) + " · finding a rider";
  return stepLabel(o.mode, o.status);
}
export const ACTIVE = ["new", "preparing", "ready", "ready_pickup", "assigned", "picked_up"];

// fee: the delivery fee for the customer's barangay (only used for Delivery)
// Totals for an order. Take-out boxes: every boxed menu item on a delivery order,
// and dine-in items the seller marked pack: "box". Add-ons and drinks need no box.
export function calcTotals(items, mode, fee = 0) {
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const deliveryFee = mode === "Delivery" && subtotal > 0 ? fee : 0;
  const boxes = items.reduce((n, it) => n + (ITEMS[it.id]?.box && (mode === "Delivery" || it.pack === "box") ? Number(it.qty) || 0 : 0), 0);
  const boxFee = boxes * (SHOP.boxFee || 0);
  return { subtotal, deliveryFee, boxes, boxFee, total: subtotal + deliveryFee + boxFee };
}
// What the shop receives for an order: everything except the rider's delivery fee
export const shopAmount = o => (o.total || 0) - (o.deliveryFee || 0);
// The "Take-out boxes" line for an order's totals (empty when there are none)
export function boxRow(o) {
  if (!o.boxFee) return "";
  const n = Math.round(o.boxFee / (SHOP.boxFee || 1));
  return `<div><span>Take-out box${n === 1 ? "" : "es"} (${n})</span><span>${peso(o.boxFee)}</span></div>`;
}

// Delivery areas: id -> { id, name, town, fee (starting fee) }. The live fees are
// saved by the owner in settings/delivery.fees and checked by firestore.rules.
export const ZONES = Object.create(null);
DELIVERY_ZONES.forEach(t => t.barangays.forEach(([id, name, fee]) => { ZONES[id] = { id, name, town: t.town, fee }; }));
export const zoneLabel = z => `${z.name}, ${z.town}`;
export const defaultFees = () => Object.fromEntries(Object.values(ZONES).map(z => [z.id, z.fee]));

// True when every line and every amount on an order matches the current menu
// (guards against orders sent straight to the database with edited prices).
export function priceCheck(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const ok = items.length > 0 && items.every(it => it && ITEMS[it.id] && ITEMS[it.id].price === it.price
    && Number.isInteger(it.qty) && it.qty > 0 && it.qty <= MAX_QTY);
  if (!ok) return false;
  // the delivery fee itself is checked against the barangay fee list by firestore.rules
  const t = calcTotals(items, order.mode, order.deliveryFee);
  return t.subtotal === order.subtotal && t.deliveryFee === order.deliveryFee && t.boxFee === (order.boxFee || 0) && t.total === order.total;
}

// Order lines as HTML. Names always come from the menu, never from the order,
// and every value is escaped, so a tampered order can't inject anything.
export function itemsHTML(order, withAmounts) {
  const items = Array.isArray(order.items) ? order.items : [];
  return `<ul class="lines">${items.map(it => {
    const known = it && ITEMS[it.id], qty = Number(it?.qty) || 0;
    const name = known ? known.name : "Unknown item: " + String(it?.name ?? it?.id ?? "?");
    const added = (Number(it?.round) > 1 ? ` <span class="pill new" style="font-size:.7rem">Added</span>` : "") // dine-in items added later
      + (it?.pack ? ` <span class="pill work" style="font-size:.7rem">Take-out · ${it.pack === "box" ? "box" : "plastic"}</span>` : "");
    return `<li><span class="q">${esc(qty)}×</span><span>${esc(name)}${added}</span><span class="amt">${withAmounts ? peso(Number(it?.price) * qty) : ""}</span></li>`;
  }).join("")}</ul>`;
}

// Online orders above this total must be paid by GCash, so a fake order can't cost
// the shop a big cash order. The owner changes it on owner.html (0 = no limit); it is
// saved as settings/store.cashMax, and firestore.rules uses the same 500 default.
export const DEFAULT_CASH_MAX = 500;
export const cashLimitOf = store => typeof store?.cashMax === "number" ? store.cashMax : DEFAULT_CASH_MAX;

// A phone number as the 10 digits after 0 / +63 ("0917 123 4567" -> "9171234567"),
// so the same number typed different ways matches. null if it isn't a PH mobile number.
export function phoneKey(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("63")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return /^9\d{9}$/.test(d) ? d : null;
}
export const telLink = p => "tel:" + String(p || "").replace(/[^\d+]/g, "");

// Reasons a seller can pick when cancelling; the customer sees the one chosen
export const CANCEL_REASONS = [
  "Sold out of an item you ordered",
  "Store is about to close",
  "We couldn't reach you by phone",
  "Your address is outside our delivery area",
  "No rider available right now",
  "You asked us to cancel"
];

// Problems a customer can report about an order; the owner sees them on owner.html
export const REPORT_REASONS = [
  "I didn't receive my food",
  "The rider asked for more money",
  "The rider was rude or unsafe",
  "Food was spilled or damaged",
  "Wrong or missing items",
  "Delivery was very late",
  "Something else"
];

export function toDate(ts) { return ts && ts.toDate ? ts.toDate() : null; }
export function fmtTime(ts) {
  const d = toDate(ts);
  return d ? d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) : "just now";
}
export function isToday(ts) {
  const d = toDate(ts); if (!d) return true;
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
// Today's date on this phone as "2026-09-30"
export function todayKey() {
  const n = new Date();
  return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
}
export function mapsLink(address) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
}
// Short code customers and staff read out loud. Taken from the order's database id, so it's unique.
export function orderCode(id) {
  return "LD-" + id.slice(0, 6).toUpperCase();
}

// Short chime for new orders (browsers only allow sound after the user taps something)
let audioCtx = null;
export function enableSound() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); return true; }
  catch (_) { return false; }
}
export function chime() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [880, 1175, 1568].forEach((f, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = f; o.type = "sine";
    g.gain.setValueAtTime(0.0001, t + i * 0.16);
    g.gain.exponentialRampToValueAtTime(0.3, t + i * 0.16 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.3);
    o.connect(g).connect(audioCtx.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.32);
  });
}

export function friendlyError(e) {
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Wrong email or password.";
  if (c.includes("email-already-in-use")) return "That email already has an account. Sign in instead.";
  if (c.includes("weak-password")) return "Use a password with at least 6 characters.";
  if (c.includes("invalid-email")) return "That email address doesn't look right.";
  if (c.includes("network") || c.includes("unavailable")) return "No internet connection. Check your signal and try again.";
  if (c.includes("permission-denied")) return "That action isn't allowed for this account.";
  if (c.includes("operation-not-allowed")) return "This sign-in method is turned off in Firebase. See the setup guide, step 3.";
  return (e && e.message) || "Something went wrong. Please try again.";
}

// Banner for the top of each page: not connected yet, or running on the test emulators
export function setupNotice() {
  if (testMode) return `<div class="notice warn"><b>Test mode.</b> This page is using the Firebase emulators on this computer.
    Nothing here is real or visible to anyone else. Test data: <a href="http://127.0.0.1:4000/firestore" target="_blank" rel="noopener">emulator dashboard</a>.</div>`;
  if (!isConfigured) return `<div class="notice warn"><b>Almost there.</b> This app isn't connected to Firebase yet.
    Open <code>config.js</code> and paste your Firebase config (setup guide, step 5).</div>`;
  return "";
}

// ---------- Rider payout account (where the shop sends the rider's earnings) ----------
// Saved on the rider as payMethod ("GCash" | "Bank"), payName, payNumber (digits only), payBank.
export const hasPayout = r => !!(r && r.payMethod && r.payNumber);
export function payoutText(r) {
  if (!hasPayout(r)) return "";
  const num = r.payMethod === "GCash" ? r.payNumber.replace(/^(\d{4})(\d{3})(\d{4})$/, "$1 $2 $3") : r.payNumber;
  return `${r.payMethod === "GCash" ? "GCash" : r.payBank} ${num} (${r.payName})`;
}
// Reads and checks a payout form. Returns { data } or { miss: [...] }.
export function readPayout(method, name, number, bank) {
  const digits = String(number || "").replace(/\D/g, ""), miss = [];
  if (!["GCash", "Bank"].includes(method)) miss.push("where we send your earnings (GCash or bank)");
  if (!String(name || "").trim()) miss.push("account name");
  let payNumber = digits;
  if (method === "GCash") {
    const k = phoneKey(digits);
    if (!k) miss.push("GCash number (09XX XXX XXXX)"); else payNumber = "0" + k;
  } else if (method === "Bank") {
    if (!String(bank || "").trim()) miss.push("bank name");
    if (!/^\d{6,20}$/.test(digits)) miss.push("bank account number (6 to 20 digits)");
  }
  if (miss.length) return { miss };
  return { data: { payMethod: method, payName: String(name).trim(), payNumber, payBank: method === "Bank" ? String(bank).trim() : "" } };
}

// ---------- Proof photos (rider at pickup and at the customer's door) ----------
// Saved in the "proofs" collection as small JPEGs (proofs/{orderId}_pickup and _delivery),
// because Firebase file storage needs a paid plan.
export const PROOF_KINDS = { pickup: "Picked up at the shop", delivery: "Delivered to the customer" };

// Shrinks a camera photo to at most 720px on the long side (about 40-80 KB), as a JPEG data URL
export function compressPhoto(file, maxSide = 720, quality = 0.55) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = quality, out = c.toDataURL("image/jpeg", q);
      while (out.length > 600000 && q > 0.3) { q -= 0.1; out = c.toDataURL("image/jpeg", q); } // stay well under the 1 MB record limit
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a photo the phone can read. Try again.")); };
    img.src = url;
  });
}

// Loads both proof photos for an order: { pickup, delivery } (each null if not taken)
export async function loadProofs(orderId) {
  const get = async kind => { try { const s = await getDoc(doc(db, "proofs", `${orderId}_${kind}`)); return s.exists() ? s.data() : null; } catch (_) { return null; } };
  const [pickup, delivery] = await Promise.all([get("pickup"), get("delivery")]);
  return { pickup, delivery };
}

// Proof photos as HTML (tap a photo to open it full size)
export function proofsHTML(p) {
  const one = kind => {
    const x = p?.[kind];
    const ok = x && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(x.photo || "");
    const when = x?.takenAt?.toDate?.().toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) || "";
    return `<figure style="margin:0;display:grid;gap:4px;justify-items:start">
      ${ok ? `<button type="button" data-proof-full style="padding:0;border:0;background:none;cursor:zoom-in"><img src="${x.photo}" alt="${esc(PROOF_KINDS[kind])} photo" style="width:140px;height:140px;object-fit:cover;border-radius:10px;border:2px solid var(--line)"></button>`
           : `<div style="width:140px;height:140px;border-radius:10px;border:2px dashed var(--line);display:grid;place-items:center;color:var(--muted);font-size:.85rem;text-align:center;padding:6px">No photo</div>`}
      <figcaption style="font-size:.8rem;color:var(--muted)">${esc(PROOF_KINDS[kind])}${when ? `<br>${esc(when)}` : ""}</figcaption></figure>`;
  };
  return `<div style="display:flex;gap:10px;flex-wrap:wrap">${one("pickup")}${one("delivery")}</div>`;
}

// Tapping a proof photo opens it full size in a new window
if (typeof document !== "undefined") document.addEventListener("click", e => {
  const b = e.target.closest?.("[data-proof-full]"); if (!b) return;
  const w = window.open("", "_blank"); if (!w) return;
  w.document.write(`<title>Proof photo</title><body style="margin:0;background:#000;display:grid;place-items:center;min-height:100vh"><img src="${b.querySelector("img").src}" style="max-width:100%;max-height:100vh"></body>`);
  w.document.close();
});
