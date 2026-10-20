// Past shifts from the order timeline (owner.html → Shifts → Record past shifts): for the time
// before cashier shifts were used, orders are grouped into shifts wherever they stop for a few
// hours. No Firebase here, so it can be tested.

const ms = t => t?.toMillis?.() ?? (t instanceof Date ? t.getTime() : (typeof t === "number" ? t : null));

// Totals for a past shift. No drawer was counted then, so "expected" is just the cash taken.
export function pastSummary(orders) {
  const s = { orders: 0, sales: 0, cashSales: 0, gcashSales: 0, cancelled: 0, deliveryFees: 0, startCash: 0, riderCash: 0,
    adjustIn: 0, adjustOut: 0, payIn: 0, payOut: 0, unpaid: 0, unpaidCount: 0 };
  orders.forEach(o => {
    if (o.status === "cancelled") { s.cancelled++; return; }
    const shop = (o.total || 0) - (o.deliveryFee || 0);
    s.orders++; s.sales += shop; s.deliveryFees += o.deliveryFee || 0;
    if (o.payment === "GCash") s.gcashSales += shop; else s.cashSales += shop;
  });
  s.expected = s.cashSales;
  return s;
}

// orders: [{ id, createdAt, status, total, deliveryFee, payment }]
// gapHours: a new shift starts when no order came in for this long
// taken: [[start ms, end ms]] times already covered by shifts (those orders are left out)
// Returns [{ start: Date, end: Date, ids: [order ids], summary }], oldest first
export function findShifts(orders, { gapHours = 3, taken = [] } = {}) {
  const gap = gapHours * 3600000;
  const list = orders.map(o => ({ o, t: ms(o.createdAt) })).filter(x => x.t != null && !taken.some(([a, b]) => x.t >= a && x.t <= b))
    .sort((a, b) => a.t - b.t);
  const groups = [];
  list.forEach(x => {
    const g = groups[groups.length - 1];
    if (g && x.t - g.last <= gap) { g.items.push(x.o); g.last = x.t; }
    else groups.push({ first: x.t, last: x.t, items: [x.o] });
  });
  return groups.filter(g => g.items.some(o => o.status !== "cancelled"))
    .map(g => ({ start: new Date(g.first), end: new Date(g.last), ids: g.items.map(o => o.id), summary: pastSummary(g.items) }));
}
