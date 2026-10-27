// ESC/POS commands for a 58 mm Bluetooth receipt printer (such as the JK-5801H) and the cash
// drawer plugged into it. Used by the seller app on Android; no Firebase here, so it can be tested.

export const WIDTH = 32; // characters per line on 58 mm paper (normal font)

// The printer only knows plain letters: "₱" becomes "P", accents are dropped
export const ascii = s => String(s ?? "").replace(/₱/g, "P").replace(/[×✕]/g, "x").replace(/[–—]/g, "-")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E\n]/g, "");
export const money = n => "P" + Number(n || 0).toLocaleString("en-PH");

// Words wrapped to the line width
export function wrap(text, width = WIDTH) {
  const out = [];
  ascii(text).split("\n").forEach(par => {
    let line = "";
    par.split(/\s+/).filter(Boolean).forEach(w => {
      while (w.length > width) { if (line) { out.push(line); line = ""; } out.push(w.slice(0, width)); w = w.slice(width); }
      if (!line) line = w; else if ((line + " " + w).length <= width) line += " " + w; else { out.push(line); line = w; }
    });
    if (line || !par) out.push(line);
  });
  return out;
}
// Text on the left, amount on the right; long text wraps and the amount goes on its last line
export function leftRight(left, right, width = WIDTH) {
  const r = ascii(right), lines = wrap(left, Math.max(8, width - r.length - 1));
  const last = lines.pop() ?? "";
  return [...lines, last + " ".repeat(Math.max(1, width - last.length - r.length)) + r];
}

const ESC = 0x1b, GS = 0x1d;
export const CMD = {
  init: [ESC, 0x40],
  left: [ESC, 0x61, 0], center: [ESC, 0x61, 1],
  boldOn: [ESC, 0x45, 1], boldOff: [ESC, 0x45, 0],
  big: [GS, 0x21, 0x11], normal: [GS, 0x21, 0x00],
  feed: n => [ESC, 0x64, n],
  // open the cash drawer: pulse on pin 2, then pin 5 (drawers are wired to one or the other)
  drawer: [ESC, 0x70, 0, 25, 250, ESC, 0x70, 1, 25, 250],
};

// Builds bytes from parts: arrays of command bytes, or text (sent as plain ASCII)
export function bytes(...parts) {
  const out = [];
  parts.flat(Infinity).forEach(p => {
    if (typeof p === "number") out.push(p & 0xff);
    else for (const ch of ascii(p)) out.push(ch.charCodeAt(0) & 0xff);
  });
  return out;
}
export const toBase64 = arr => { let s = ""; for (let i = 0; i < arr.length; i += 4096) s += String.fromCharCode(...arr.slice(i, i + 4096)); return btoa(s); };

export function openDrawerBytes() { return bytes(CMD.init, CMD.drawer); }

// A black-and-white picture (the logo) as printer dots: logo = { width, height, bits }, width a
// multiple of 8, bits one byte per dot row by row (1 = black). GS v 0 = print raster image.
export function rasterBytes(logo) {
  if (!logo?.width || !logo?.height || !logo?.bits) return [];
  const per = logo.width / 8, out = [GS, 0x76, 0x30, 0, per & 0xff, per >> 8, logo.height & 0xff, logo.height >> 8];
  for (let y = 0; y < logo.height; y++)
    for (let x = 0; x < per; x++) {
      let b = 0;
      for (let k = 0; k < 8; k++) if (logo.bits[y * logo.width + x * 8 + k]) b |= 0x80 >> k;
      out.push(b);
    }
  return out;
}

// The receipt for an order. shop: { name, pickupAddress, phone, logo? (see rasterBytes) }. extra: { customer, mobile,
// itemName(id) -> name, lines (merged order lines), cashFirst, adjust, balance, notPaid,
// finished? { paid, title ("Delivered Oct 21, 3:05 PM"), rider, payText } for a delivered order }
export function receiptBytes(o, shop, extra = {}) {
  const L = [], line = s => L.push(s), rule = () => line("-".repeat(WIDTH));
  const when = o.createdAt?.toDate?.() || new Date();
  const lr = (l, r) => leftRight(l, r).forEach(line);
  rule();
  lr("Order", o.code || "");
  lr("Date", when.toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }));
  lr("Type", extra.type || o.mode || "");
  if (o.table) lr("Table", o.table);
  if (extra.customer) lr("Customer", extra.customer);
  if (extra.mobile) lr("Mobile", extra.mobile);
  if (o.mode === "Delivery" && o.address) wrap("Deliver to: " + o.address).forEach(line);
  rule();
  (extra.lines || o.items || []).forEach(it => {
    const qty = Number(it.qty) || 0, price = Number(it.price) || 0;
    lr(`${qty} x ${extra.itemName ? extra.itemName(it) : it.name}`, money(price * qty));
    if (qty > 1) line("    @ " + money(price));
  });
  rule();
  lr("Subtotal", money(o.subtotal));
  if (o.deliveryFee) lr("Delivery fee", money(o.deliveryFee));
  if (o.boxFee) lr("Take-out boxes", money(o.boxFee));
  const body = L.splice(0);

  lr("TOTAL", money(o.total)); const total = L.splice(0);
  if (extra.finished?.payText) wrap("Payment: " + extra.finished.payText).forEach(line);
  else lr("Payment", (o.payment || "") + (extra.notPaid ? " - NOT PAID" : ""));
  if (o.gcashRef) lr("GCash Ref", o.gcashRef);
  if (o.cashGiven != null) { lr("Cash", money(o.cashGiven)); }
  const pay = L.splice(0);
  const change = o.cashGiven != null ? leftRight("CHANGE", money(o.cashGiven - (extra.cashFirst ?? o.total))) : [];
  if (extra.adjust > 0) lr("Extra paid", money(extra.adjust));
  if (extra.adjust < 0) lr("Given back", money(-extra.adjust));
  if (extra.balance > 0) lr("STILL TO PAY", money(extra.balance));
  if (extra.balance < 0) lr("TO GIVE BACK", money(-extra.balance));
  const after = L.splice(0);
  if (o.notes) { rule(); wrap("Notes: " + o.notes).forEach(line); }
  rule();
  const tail = L.splice(0);

  const nl = arr => arr.map(s => s + "\n");
  return bytes(
    CMD.init, CMD.center, shop.logo ? [rasterBytes(shop.logo), "\n"] : [], CMD.boldOn, CMD.big, nl(wrap(shop.name, WIDTH / 2)), CMD.normal, CMD.boldOff,
    nl(wrap(shop.pickupAddress || "")), shop.phone ? ascii(shop.phone) + "\n" : "", CMD.left,
    nl(body), CMD.boldOn, nl(total), CMD.boldOff, nl(pay), CMD.boldOn, nl(change), CMD.boldOff, nl(after), nl(tail),
    extra.finished ? [CMD.center, CMD.boldOn, CMD.big, extra.finished.paid ? "PAID\n" : "NOT PAID YET\n", CMD.normal, CMD.boldOff,
      nl(wrap(extra.finished.title || "")), extra.finished.rider ? nl(wrap("Rider: " + extra.finished.rider)) : [], "-".repeat(WIDTH) + "\n"] : [],
    CMD.center, "Salamat po! Come again.\n", "Order slip only.\nNot an official receipt.\n", CMD.left, CMD.feed(4)
  );
}

// What the kitchen needs to refill, printed when a shift closes. rows: [{ name, unit, onHand, par, need, price? }]
export function refillBytes(rows, when = new Date()) {
  const L = [], n = v => String(Math.round((Number(v) || 0) * 100) / 100);
  // one line per item: item and how much to get, and what it costs (when the owner set a price per unit)
  const cost = r => Math.round(r.need * r.price * 100) / 100, qty = r => (n(r.need) + " " + (r.unit || "")).trim();
  rows.forEach(r => leftRight(r.price != null ? r.name + " " + qty(r) : r.name, r.price != null ? money(cost(r)) : qty(r)).forEach(x => L.push(x)));
  if (rows.some(r => r.price != null)) { L.push("-".repeat(WIDTH)); leftRight("TOTAL", money(rows.reduce((t, r) => t + (r.price != null ? cost(r) : 0), 0))).forEach(x => L.push(x)); }
  const nl = a => a.map(x => x + "\n");
  return bytes(CMD.init, CMD.center, CMD.boldOn, CMD.big, "TO REFILL\n", CMD.normal, CMD.boldOff,
    when.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + "\n", CMD.left,
    "-".repeat(WIDTH) + "\n", rows.length ? nl(L) : "Everything is at its standard\nstock. Nothing to refill.\n",
    "-".repeat(WIDTH) + "\n", CMD.center, "For the kitchen\n", CMD.left, CMD.feed(4));
}

// Shift report: s = shiftSummary(...), shift = the shift record
export function shiftBytes(s, shift, shop) {
  const L = [], lr = (l, r) => leftRight(l, r).forEach(x => L.push(x)), rule = () => L.push("-".repeat(WIDTH));
  const t = v => (v?.toDate?.() || (v ? new Date(v) : new Date())).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  lr("Opened", t(shift.openedAt)); lr("by", shift.openedByName || "");
  if (shift.closedAt !== null && shift.closedAt !== undefined) { lr("Closed", t(shift.closedAt)); lr("by", shift.closedByName || ""); }
  rule();
  lr("Orders", String(s.orders)); lr("Sales", money(s.sales)); lr("GCash", money(s.gcashSales));
  if (s.unpaidCount) lr(`Unpaid (${s.unpaidCount})`, money(s.unpaid));
  rule();
  lr("Starting cash", money(s.startCash)); lr("Cash sales", money(s.cashSales));
  if (s.riderCash) lr("Cash from riders", money(s.riderCash));
  if (s.adjustIn) lr("Extra collected", money(s.adjustIn));
  if (s.adjustOut) lr("Given back", "-" + money(s.adjustOut));
  if (s.payIn) lr("Pay in", money(s.payIn));
  if (s.payOut) lr("Pay out", "-" + money(s.payOut));
  const body = L.splice(0);
  lr("EXPECTED CASH", money(s.expected));
  if (s.counted != null) { lr("COUNTED", money(s.counted)); const d = s.counted - s.expected; lr(d === 0 ? "EXACT" : d > 0 ? "OVER" : "SHORT", money(Math.abs(d))); }
  const totals = L.splice(0);
  (shift.moves || []).forEach(m => lr(`${m.type === "in" ? "In" : "Out"}: ${m.note}`, money(m.amount)));
  const moves = L.splice(0);
  const nl = a => a.map(x => x + "\n");
  return bytes(CMD.init, CMD.center, CMD.boldOn, nl(wrap(shop.name)), "SHIFT REPORT\n", CMD.boldOff, CMD.left,
    nl(body), CMD.boldOn, nl(totals), CMD.boldOff, moves.length ? ["-".repeat(WIDTH) + "\n", nl(moves)] : [], CMD.feed(4));
}
