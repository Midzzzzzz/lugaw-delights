// Reads a Loyverse "Receipts by item" export (CSV) and turns it into finished orders the owner
// can import (owner.html → Orders → Import from Loyverse). No Firebase here, so it can be tested.
//   - each receipt becomes one order on its own date and time
//   - "Take out bowl" lines become the take-out box fee, "Delivery …" lines the delivery fee
//   - a refund takes its items off the most recent earlier sale that had them (so Loyverse's
//     refunded sales don't count twice)
//   - item names are matched to the menu ("Extra egg" → "Add-on: Egg"); items not on the menu
//     keep their Loyverse name and price

// CSV with quoted fields ("a, b" and "" inside quotes)
export function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some(x => x !== "")) rows.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.some(x => x !== "")) rows.push(row);
  return rows;
}

// "10/20/26 12:42 AM" (month/day/year, as Loyverse exports it in the Philippines)
export function parseDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (!m) return null;
  let [, mo, d, y, h, mi, sec, ap] = m; y = +y; if (y < 100) y += 2000; h = +h;
  if (ap) { ap = ap.toUpperCase(); if (ap === "PM" && h < 12) h += 12; if (ap === "AM" && h === 12) h = 0; }
  return new Date(y, +mo - 1, +d, h, +mi, +(sec || 0));
}

const norm = s => String(s || "").toLowerCase().replace(/^add-on:\s*/, "").replace(/[^a-z0-9]/g, "");
const isBowl = name => /take\s*-?\s*out\s*(bowl|box)/i.test(name);
const isDelivery = name => /^delivery\b/i.test(String(name).trim());

// Finds the menu item for a Loyverse item name. items: { id: { name } }
export function matcher(items) {
  const index = {};
  Object.values(items).forEach(it => { const k = norm(it.name); if (k && !(k in index)) index[k] = it.id; });
  const keys = Object.keys(index);
  return name => {
    const n = norm(name); if (!n) return null;
    const tries = [n];
    if (n.startsWith("extra")) tries.push(n.slice(5));
    tries.push("plain" + n, n.replace("withliver", "withchickenliver"));
    for (const t of tries) if (index[t]) return index[t];
    const pre = keys.filter(k => k.startsWith(n));
    return pre.length === 1 ? index[pre[0]] : null;
  };
}

// Returns { orders, unmatched: { name: qty }, problems: [text], refunds, refundsUnmatched }
// orders: [{ receipt, when (Date), mode, items: [{ id, name, price, qty }], subtotal, boxFee, deliveryFee, total }]
export function readLoyverse(text, items) {
  const rows = parseCSV(text);
  if (!rows.length) return { orders: [], unmatched: {}, problems: ["The file is empty."], refunds: 0, refundsUnmatched: 0 };
  const head = rows[0].map(h => h.trim().toLowerCase()), col = name => head.indexOf(name);
  const need = ["date", "receipt number", "receipt type", "item", "quantity", "net sales"];
  const missing = need.filter(n => col(n) < 0);
  if (missing.length) return { orders: [], unmatched: {}, problems: [`This doesn't look like a Loyverse "Receipts by item" export (missing: ${missing.join(", ")}).`], refunds: 0, refundsUnmatched: 0 };
  const get = (r, n) => (col(n) >= 0 ? (r[col(n)] ?? "") : "").trim();
  const match = matcher(items), problems = [];

  // Group the lines by receipt
  const byReceipt = new Map();
  rows.slice(1).forEach((r, i) => {
    const no = get(r, "receipt number"); if (!no) return;
    const when = parseDate(get(r, "date"));
    if (!when) { problems.push(`Line ${i + 2}: couldn't read the date "${get(r, "date")}".`); return; }
    if (/cancel/i.test(get(r, "status"))) return;
    const rec = byReceipt.get(no) || { receipt: no, when, type: /refund/i.test(get(r, "receipt type")) ? "refund" : "sale", option: get(r, "dining option"), lines: [] };
    rec.lines.push({ name: get(r, "item"), sku: get(r, "sku"), qty: Number(get(r, "quantity")) || 0, net: Number(get(r, "net sales")) || 0 });
    byReceipt.set(no, rec);
  });
  const all = [...byReceipt.values()].sort((a, b) => a.when - b.when);

  // Sales: items, boxes and delivery fee per receipt
  const sales = all.filter(r => r.type === "sale").map(r => {
    const o = { receipt: r.receipt, when: r.when, option: r.option, lines: [], boxQty: 0, boxFee: 0, deliveryFee: 0 };
    r.lines.forEach(l => {
      if (isBowl(l.name)) { o.boxQty += l.qty; o.boxFee += l.net; }
      else if (isDelivery(l.name)) o.deliveryFee += l.net;
      else o.lines.push({ name: l.name, sku: l.sku, qty: l.qty, price: l.qty ? Math.round(l.net / l.qty * 100) / 100 : 0 });
    });
    return o;
  });

  // Refunds take their lines off the latest earlier sale that has them
  let refunds = 0, refundsUnmatched = 0;
  all.filter(r => r.type === "refund").forEach(r => {
    refunds++;
    const before = sales.filter(s => s.when <= r.when).reverse();
    r.lines.forEach(l => {
      let left = Math.abs(l.qty);
      if (isBowl(l.name)) { for (const s of before) { const t = Math.min(left, s.boxQty); if (t > 0) { const per = s.boxFee / s.boxQty; s.boxQty -= t; s.boxFee = Math.round((s.boxFee - per * t) * 100) / 100; left -= t; } if (!left) break; } }
      else if (isDelivery(l.name)) { const s = before.find(s => s.deliveryFee >= Math.abs(l.net)); if (s) { s.deliveryFee -= Math.abs(l.net); left = 0; } }
      else for (const s of before) {
        for (const x of s.lines) { if (x.name === l.name && x.qty > 0) { const t = Math.min(left, x.qty); x.qty -= t; left -= t; if (!left) break; } }
        if (!left) break;
      }
      if (left > 0) refundsUnmatched++;
    });
  });

  // Build the orders
  const unmatched = {};
  const orders = sales.map(s => {
    const merged = new Map();
    s.lines.filter(l => l.qty > 0).forEach(l => {
      const found = match(l.name), id = found || ("LV" + (l.sku || norm(l.name)).slice(0, 20));
      if (!found) unmatched[l.name] = (unmatched[l.name] || 0) + l.qty;
      const k = id + "@" + l.price, m = merged.get(k);
      // menu items keep the menu's name; the price stays what Loyverse charged
      if (m) m.qty += l.qty; else merged.set(k, { id, name: found ? items[found].name : l.name, price: l.price, qty: l.qty });
    });
    const lines = [...merged.values()];
    lines.forEach(it => { if (!Number.isInteger(it.qty)) { problems.push(`Receipt ${s.receipt}: ${it.name} has a part quantity (${it.qty}); it was rounded.`); it.qty = Math.max(1, Math.round(it.qty)); } });
    lines.forEach(it => { if (!Number.isInteger(it.price)) { problems.push(`Receipt ${s.receipt}: ${it.name} costs ₱${it.price}; it was rounded to whole pesos.`); it.price = Math.round(it.price); } });
    const subtotal = lines.reduce((n, it) => n + it.price * it.qty, 0);
    const boxFee = Math.round(s.boxFee), deliveryFee = Math.round(s.deliveryFee);
    const mode = deliveryFee > 0 || /deliver/i.test(s.option) ? "Delivery" : /take\s*-?\s*out|pick/i.test(s.option) ? "Pickup" : "Dine-in";
    return { receipt: s.receipt, when: s.when, mode, items: lines, subtotal, boxFee, deliveryFee, total: subtotal + boxFee + deliveryFee };
  }).filter(o => o.items.length && o.subtotal > 0);
  orders.forEach(o => { if (o.items.length > 20) problems.push(`Receipt ${o.receipt} has ${o.items.length} different items; only 20 fit in one order, so it will be skipped.`); });
  return { orders, unmatched, problems, refunds, refundsUnmatched };
}
