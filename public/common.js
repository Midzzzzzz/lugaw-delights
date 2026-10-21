// Shared setup and helpers for all three pages. You don't need to edit this file.
import { initializeApp } from "./fb/app.js";
import { getAuth, connectAuthEmulator } from "./fb/auth.js";
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from "./fb/firestore.js";
import { SERVER, SHOP, MENU as START_MENU, DELIVERY_ZONES } from "./config.js";

export { SHOP, DELIVERY_ZONES };

// The shop's own server (PHP + MySQL): the api/ folder next to the pages, or SERVER.apiBase in the apps
export const testMode = false;
export const isConfigured = true;
const cfg = SERVER.apiBase ? { apiBase: SERVER.apiBase } : {};

// Each kind of page keeps its own sign-in (<meta name="app-role">): customer,
// rider, seller and owner. Signing in on one never signs you in on another, and
// staff signing in on a phone doesn't lose that phone's customer orders.
const role = document.querySelector('meta[name="app-role"]')?.content;
export const app = isConfigured ? initializeApp(cfg, role || "[DEFAULT]") : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

// ---------- Menu ----------
// The owner edits the menu on owner.html; it's saved in settings/menu. Until the owner first
// saves, the menu in config.js is used. Each item: { id, name, price, inc, best, off, was }
// (off = sold out / hidden; was = earlier prices, so orders placed before a price change
// still pass the price check). The last menu loaded is kept on the device in case it's offline.
export function startMenu() {
  return START_MENU.map(c => ({ id: c.id, name: c.name, box: !!c.box, note: c.note || "",
    items: c.items.map(([id, name, price, inc, best]) => ({ id, name, price, inc: inc || "", best: !!best })) }));
}
async function loadMenu() {
  if (db) try {
    const s = await Promise.race([getDoc(doc(db, "settings", "menu")),
      new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 6000))]);
    if (!s.exists() || !Array.isArray(s.data().sections)) return startMenu();
    try { localStorage.setItem("lugaw-menu", JSON.stringify(s.data().sections)); } catch (_) {}
    return s.data().sections;
  } catch (_) {}
  try { const m = JSON.parse(localStorage.getItem("lugaw-menu")); if (Array.isArray(m)) return m; } catch (_) {}
  return startMenu();
}
export const MENU_SECTIONS = await loadMenu();
// What the menus show: [id, name, price, inc, best] per item, sold-out items left off
export const MENU = MENU_SECTIONS.map(c => ({ ...c, items: (c.items || []).filter(it => !it.off).map(it => [it.id, it.name, it.price, it.inc, it.best]) }))
  .filter(c => c.items.length);
// Every item, sold out or not (names and prices for older orders)
export const ITEMS = Object.create(null);
MENU_SECTIONS.forEach(c => (c.items || []).forEach(it => {
  ITEMS[it.id] = { id: it.id, name: it.name, price: it.price, inc: it.inc || "", best: !!it.best, cat: c.id, box: !!c.box, off: !!it.off, was: it.was || [],
    recipe: it.recipe || {}, // ingredient id -> amount one serving uses
    takeout: it.takeout || {} }; // ingredient id -> amount used only when it's packed to go (e.g. its take-out box)
}));

// Bring ITEMS up to date with a newer saved menu (recipes, prices, names) without reloading,
// so a change the owner just saved counts right away. New items still need a page refresh
// to appear on the menus.
// MENU is updated in place too, so a page that redraws its menu (the seller's dine-in buttons)
// also drops deleted items and shows new ones.
export function applyMenu(sections) {
  if (!Array.isArray(sections)) return;
  const live = new Set();
  sections.forEach(c => (c.items || []).forEach(it => {
    live.add(it.id);
    const t = ITEMS[it.id] || (ITEMS[it.id] = { id: it.id });
    Object.assign(t, { name: it.name, price: it.price, inc: it.inc || "", best: !!it.best, cat: c.id, box: !!c.box,
      off: !!it.off, was: it.was || [], recipe: it.recipe || {}, takeout: it.takeout || {} });
  }));
  Object.values(ITEMS).forEach(t => { if (!live.has(t.id)) t.off = true; }); // deleted: kept for older orders, not sold
  MENU.splice(0, MENU.length, ...sections.map(c => ({ ...c, items: (c.items || []).filter(it => !it.off).map(it => [it.id, it.name, it.price, it.inc, it.best]) }))
    .filter(c => c.items.length));
}

// ---------- Ingredient stock ----------
// An order line is packed to go when it's a delivery or pickup, or a dine-in line the seller
// marked "Box". Packed lines also use the item's take-out ingredients (its box).
export const packed = (line, mode) => mode === "Delivery" || mode === "Pickup" || line?.pack === "box";
// What one of an item uses: its recipe, plus its take-out ingredients when packed
export function uses(id, isPacked) {
  const r = { ...(ITEMS[id]?.recipe || {}) };
  if (isPacked) Object.entries(ITEMS[id]?.takeout || {}).forEach(([g, q]) => { r[g] = (r[g] || 0) + q; });
  return r;
}
// The owner's open inventory count holds the beginning amount of each ingredient. Every order
// placed since the count started (not cancelled) uses each item's recipe × quantity.
// Returns what's left of each counted ingredient.
export function ingredientsLeft(count, orders) {
  if (!count || count.closedAt) return null;
  const left = { ...(count.items || {}) }, since = count.since?.toMillis?.() || 0;
  orders.forEach(o => {
    if (o.status === "cancelled" || (o.createdAt?.toMillis?.() ?? Date.now()) < since) return;
    (o.items || []).forEach(it => Object.entries(uses(it.id, packed(it, o.mode))).forEach(([g, per]) => {
      if (g in left) left[g] = Math.round((left[g] - per * (Number(it.qty) || 0)) * 1000) / 1000;
    }));
  });
  return left;
}
// Stock tracker (settings/inventory): par = the standard stock the owner set, base = what was on
// hand at the last refill (since). As a "count" for ingredientsLeft: base minus orders since then.
export const trackerCount = inv => inv && inv.base && inv.since ? { items: inv.base, since: inv.since, closedAt: null } : null;
// What to refill: every ingredient with a standard stock that's below it (left: ingredientsLeft)
export function belowStandard(inv, left) {
  return Object.entries(inv?.par || {}).map(([g, par]) => {
    const onHand = Math.round((left?.[g] ?? inv?.base?.[g] ?? 0) * 100) / 100;
    return { g, par, onHand, need: Math.round((par - onHand) * 100) / 100 };
  }).filter(r => r.need > 0);
}
// How many more servings of an item the ingredients allow (null: the item has no ingredients set,
// so it isn't limited). While a count is open, an ingredient it needs that wasn't counted is
// treated as none left, so the item can't be sold until that ingredient's stock is entered.
// isPacked: count its take-out box too (customer orders are always delivered)
export function servingsLeft(id, left, isPacked = false) {
  if (!left) return null;
  const parts = Object.entries(uses(id, isPacked)).filter(([, per]) => per > 0);
  return parts.length ? Math.max(0, Math.min(...parts.map(([g, per]) => Math.floor((left[g] ?? 0) / per + 1e-9)))) : null;
}
// Whether order lines can be made with what's left (ingredients shared between items add up).
// Returns the id of the first item that runs short, or null when everything fits.
// mode: the order type, so packed lines count their take-out box
export function shortItem(lines, left, mode = "Dine-in") {
  if (!left) return null;
  const need = {};
  for (const it of lines) {
    for (const [g, per] of Object.entries(uses(it.id, packed(it, mode)))) {
      if (!(per > 0)) continue;
      need[g] = (need[g] || 0) + per * (Number(it.qty) || 0);
      if (need[g] > (left[g] ?? 0) + 1e-9) return it.id; // not counted = none left
    }
  }
  return null;
}
// Items that can't be made with what's left: shown as sold out. Published for the customer
// page, where every order is delivered, so an item whose take-out box ran out counts too.
export function soldOutFrom(left, isPacked = true) {
  return Object.keys(ITEMS).filter(id => servingsLeft(id, left, isPacked) === 0).sort();
}
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

// ---------- Cashier shifts ----------
// What happened in a shift, from its orders: sales, cash and GCash taken, and the cash that should
// be in the drawer. A sale belongs to the shift it was rung up in; GCash to when it was received;
// a rider's cash to when the shop got it. Sales the owner added by hand or imported are left out.
const ms = t => t?.toMillis?.() ?? (t instanceof Date ? t.getTime() : null);
export function shiftSummary(shift, orders, now = Date.now()) {
  const from = ms(shift.openedAt) ?? now, to = ms(shift.closedAt) ?? now;
  const inShift = t => t != null && t >= from && t < to + 1;
  const s = { orders: 0, sales: 0, cashSales: 0, gcashSales: 0, riderCash: 0, adjustIn: 0, adjustOut: 0, unpaid: 0, unpaidCount: 0, cancelled: 0,
    payIn: 0, payOut: 0, startCash: shift.startCash || 0 };
  orders.forEach(o => {
    if (o.manual) return;
    const made = ms(o.createdAt) ?? now;
    if (o.status === "cancelled") { if (inShift(made)) s.cancelled++; return; }
    if (inShift(made)) { s.orders++; s.sales += shopAmount(o); }
    if (o.mode === "Delivery") {
      const got = ms(o.riderPaidAt) ?? ms(o.settledAt);
      if (o.payment === "Cash" && o.cashReceived && inShift(got)) s.riderCash += shopAmount(o);
      return;
    }
    if (!inShift(made)) return;
    // pickup orders are paid at the counter when they're collected
    if (o.mode === "Pickup") { if (o.status === "completed") { if (o.payment === "GCash") s.gcashSales += o.total || 0; else s.cashSales += o.total || 0; } return; }
    const paid = o.cashGiven != null || o.paid === true, first = o.paidTotal ?? o.total ?? 0;
    if (!paid) { s.unpaid += o.total || 0; s.unpaidCount++; return; }
    if (o.cashGiven != null) s.cashSales += first; else s.gcashSales += first;
    const adj = o.settledTotal != null ? o.settledTotal - first : 0; // extra collected or given back after a change
    if (o.payment === "Cash") { if (adj > 0) s.adjustIn += adj; else s.adjustOut -= adj; }
    else if (adj) s.gcashSales += adj;
  });
  (shift.moves || []).forEach(m => { if (m.type === "in") s.payIn += m.amount; else s.payOut += m.amount; });
  s.expected = s.startCash + s.cashSales + s.riderCash + s.adjustIn - s.adjustOut + s.payIn - s.payOut;
  return s;
}
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
  // the current price, or an earlier one (the order was placed before the owner changed it)
  const ok = items.length > 0 && items.every(it => it && ITEMS[it.id] && (ITEMS[it.id].price === it.price || ITEMS[it.id].was.includes(it.price))
    && Number.isInteger(it.qty) && it.qty > 0 && it.qty <= MAX_QTY);
  if (!ok) return false;
  // the delivery fee itself is checked against the barangay fee list by firestore.rules
  const t = calcTotals(items, order.mode, order.deliveryFee);
  return t.subtotal === order.subtotal && t.deliveryFee === order.deliveryFee && t.boxFee === (order.boxFee || 0) && t.total === order.total;
}

// Order lines as HTML. Names always come from the menu, never from the order,
// and every value is escaped, so a tampered order can't inject anything.
// Order lines with the same item (and packing) added in later rounds merged into one:
// 3 Lugaw + 1 Lugaw added later = "4× Lugaw (+1 added)". addedQty = how many came later.
export function mergedLines(items) {
  const m = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it) continue;
    const k = `${it.id}|${it.pack || ""}|${it.price}`, q = Number(it.qty) || 0;
    const r = m.get(k) || { ...it, qty: 0, addedQty: 0 };
    r.qty += q; if (Number(it.round) > 1) r.addedQty += q;
    m.set(k, r);
  }
  return [...m.values()];
}
export function itemsHTML(order, withAmounts) {
  const items = mergedLines(order.items);
  return `<ul class="lines">${items.map(it => {
    const known = it && ITEMS[it.id], qty = Number(it?.qty) || 0;
    const name = known ? known.name : it?.name ? String(it.name) : "Unknown item: " + String(it?.id ?? "?");
    const added = (it.addedQty ? ` <span class="pill new" style="font-size:.7rem">${it.addedQty < qty ? `+${it.addedQty} added` : "Added"}</span>` : "") // dine-in items added later
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

// ---------- Order alerts ----------
// One alert for a new order (or, for customers, their order moving on): a banner at the top of
// the screen, the chime and a buzz. In the Android apps alerts are on from the start, and when
// the app is in the background the alert also goes to the phone's notification bar.
export const inApp = () => typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();
const notifier = () => inApp() ? window.Capacitor.Plugins?.LocalNotifications : null;
let alertsReady = false, alertId = 1;
export async function setupAlerts() {
  if (alertsReady || typeof document === "undefined") return;
  alertsReady = true;
  // Sound needs one tap first in a browser (and sometimes on a phone): any tap turns it on
  document.addEventListener("pointerdown", () => { enableSound(); }, { once: true });
  if (!inApp()) return;
  enableSound();
  const n = notifier(); if (!n) return;
  try {
    let p = await n.checkPermissions();
    if (p.display !== "granted") p = await n.requestPermissions();
    await n.createChannel?.({ id: "orders", name: "Orders", description: "New orders and order updates", importance: 5, visibility: 1, vibration: true });
  } catch (_) {}
}
export function notify(title, body = "") {
  chime();
  try { navigator.vibrate?.([250, 120, 250]); } catch (_) {}
  showAlert(title, body);
  const n = notifier();
  if (n && document.visibilityState === "hidden")
    n.schedule({ notifications: [{ id: (Date.now() % 1e8) + alertId++, title, body, channelId: "orders" }] }).catch(() => {});
}
function showAlert(title, body) {
  if (typeof document === "undefined") return;
  let box = document.getElementById("alerts");
  if (!box) {
    box = document.createElement("div"); box.id = "alerts"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "assertive");
    box.style.cssText = "position:fixed;left:8px;right:8px;top:max(8px,env(safe-area-inset-top));z-index:200;display:grid;gap:6px;pointer-events:none";
    document.body.append(box);
  }
  const b = document.createElement("button"); b.type = "button";
  b.style.cssText = "pointer-events:auto;text-align:left;border:0;border-radius:14px;padding:12px 14px;background:var(--brand,#e0284f);color:var(--on-brand,#fff);box-shadow:0 6px 20px rgba(0,0,0,.28);font:inherit;width:100%;max-width:520px;margin:0 auto;cursor:pointer";
  b.innerHTML = `<b style="display:block;font-size:1.05rem">${esc(title)}</b>${body ? `<span style="display:block">${esc(body)}</span>` : ""}<span style="display:block;font-size:.75rem;opacity:.85;margin-top:2px">Tap to close</span>`;
  b.onclick = () => b.remove();
  box.prepend(b);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => b.remove(), 20000);
}
// "Delivery · 2× Plain Lugaw, 1× Coke" for an alert
export function orderSummary(o) {
  const items = (o.items || []).map(i => `${i.qty}× ${i.name}`).join(", ");
  const s = [o.mode, items].filter(Boolean).join(" · ");
  return s.length > 90 ? s.slice(0, 89) + "…" : s;
}

// A save the server hasn't confirmed after a while counts as not saved
export const saved = (p, ms = 20000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no({ code: "save-timeout" }), ms))]);

export function friendlyError(e) {
  const c = (e && e.code) || "";
  if (c === "save-timeout") return "Not saved: the server didn't answer. Check the internet connection and try again. Your change will be lost when you refresh.";
  if (c.includes("too-many-requests")) return "Too many tries. Wait a few minutes and try again.";
  if (c.includes("expired-action-code")) return "This link has expired. Ask for a new one.";
  if (c === "aborted") return "Someone else changed this at the same moment. Please try again.";
  if (c === "not-found") return "That was deleted or doesn't exist any more.";
  if (c === "internal") return "The server had a problem. Please try again.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Wrong username, email or password.";
  if (c.includes("email-already-in-use")) return "That email already has an account. Sign in instead.";
  if (c.includes("weak-password")) return "Use a password with at least 6 characters.";
  if (c.includes("invalid-email")) return "That email address doesn't look right.";
  if (c.includes("network") || c.includes("unavailable")) return "No internet connection. Check your signal and try again.";
  if (c.includes("permission-denied")) return "That action isn't allowed for this account.";
  return (e && e.message) || "Something went wrong. Please try again.";
}

// Banner for the top of each page: not connected yet, or running on the test emulators
export function setupNotice() {
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

// A customer's payment screenshot (orders paid by QR): a button that loads it on demand, so the
// lists don't download every picture. Staff tap it, then tap the picture to see it full size.
export function payShotButton(o) {
  return o.payShotAt ? `<button type="button" class="btn ghost small" data-payshot="${esc(o.id)}">View payment screenshot</button>` : "";
}
if (typeof document !== "undefined") document.addEventListener("click", async e => {
  const b = e.target.closest?.("[data-payshot]"); if (!b) return;
  b.disabled = true; b.textContent = "Loading…";
  try {
    const s = await getDoc(doc(db, "payshots", b.dataset.payshot)), p = s.exists() ? s.data().photo : "";
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p || "")) { b.textContent = "No screenshot found"; return; }
    const when = s.data().sentAt?.toDate?.().toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) || "";
    b.outerHTML = `<figure style="margin:0;display:grid;gap:4px;justify-items:start"><button type="button" data-proof-full style="padding:0;border:0;background:none;cursor:zoom-in"><img src="${p}" alt="Payment screenshot" style="width:160px;max-height:320px;object-fit:contain;border-radius:10px;border:2px solid var(--line)"></button><figcaption style="font-size:.8rem;color:var(--muted)">Payment screenshot${when ? " · " + esc(when) : ""}. Tap to enlarge.</figcaption></figure>`;
  } catch (x) { b.disabled = false; b.textContent = "Couldn't load. Tap to try again"; }
});

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
