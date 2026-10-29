// Shift totals for delivery orders: a GCash / QR delivery the seller confirmed is GCash the shop
// received (not money with the rider); a cash delivery is cash the rider paid at pickup.
// common.js is a browser module: give it the little of a page it reads at load
globalThis.document ??= { querySelector: () => null, addEventListener() {}, hidden: false };
globalThis.location ??= { hostname: "localhost", origin: "http://localhost", search: "", href: "http://localhost/" };
const { shiftSummary } = await import("../public/common.js");

let pass = 0, fail = 0;
const t = (n, ok) => { if (ok) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n); } };
const at = h => ({ toMillis: () => new Date(2026, 9, 20, h).getTime() });
const shift = { openedAt: at(8), closedAt: at(20), startCash: 500, moves: [] };
const del = over => ({ mode: "Delivery", status: "delivered", subtotal: 100, boxFee: 10, deliveryFee: 40, total: 150, createdAt: at(10), ...over });

console.log("Delivery orders in a shift");
let s = shiftSummary(shift, [del({ payment: "GCash", paymentConfirmed: true, paymentConfirmedAt: at(10), settled: false })]);
t("confirmed GCash delivery counts as GCash received (food and boxes)", s.gcashSales === 110 && s.sales === 110);
t("it isn't counted as cash from the rider", s.riderCash === 0 && s.expected === 500);
t("and it isn't unpaid", s.unpaid === 0);
s = shiftSummary(shift, [del({ payment: "GCash", payShotAt: at(10) })]);
t("GCash delivery not confirmed yet shows as not paid yet", s.unpaidCount === 1 && s.unpaid === 110 && s.gcashSales === 0);
s = shiftSummary(shift, [del({ payment: "GCash", paymentConfirmed: true, createdAt: at(6), paymentConfirmedAt: at(9) })]);
t("GCash counts in the shift it was confirmed in", s.gcashSales === 110);
s = shiftSummary(shift, [del({ payment: "Cash", riderPaid: true, riderPaidAt: at(11), cashReceived: true, settled: true })]);
t("cash delivery: the rider paid at pickup, so it's cash in the drawer", s.riderCash === 110 && s.expected === 610 && s.gcashSales === 0);
s = shiftSummary(shift, [{ mode: "Dine-in", status: "completed", payment: "Cash", cashGiven: 100, total: 78, paidTotal: 78, createdAt: at(12) },
  del({ payment: "GCash", paymentConfirmed: true, paymentConfirmedAt: at(13), createdAt: at(13) })]);
t("mixed shift: sales are the dine-in and the delivery", s.sales === 188 && s.cashSales === 78 && s.gcashSales === 110 && s.expected === 578);
t("mixed shift: dine-in and delivery sales shown apart, and they add up to the total", s.dineSales === 78 && s.deliverySales === 110 && s.dineSales + s.deliverySales === s.sales);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
