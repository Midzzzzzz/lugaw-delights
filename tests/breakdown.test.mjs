// Owner dashboard numbers: every sale on one "sold through" line and one "money" line, and they add up.
globalThis.document ??= { querySelector: () => null, addEventListener() {}, hidden: false };
globalThis.location ??= { hostname: "localhost", origin: "http://localhost", search: "", href: "http://localhost/" };
const { salesBreakdown, salePayment } = await import("../public/common.js");

let pass = 0, fail = 0;
const t = (n, ok) => { if (ok) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n); } };
const dine = over => ({ mode: "Dine-in", status: "completed", payment: "Cash", subtotal: 100, boxFee: 0, deliveryFee: 0, total: 100, ...over });
const del = over => ({ mode: "Delivery", status: "delivered", payment: "Cash", subtotal: 100, boxFee: 10, deliveryFee: 40, total: 150, ...over });
const orders = [
  dine({ cashGiven: 200, paidTotal: 100 }),                                   // cash dine-in 100
  dine({ payment: "GCash", paid: true, paidTotal: 100 }),                     // GCash dine-in 100
  dine({}),                                                                    // served, not paid 100
  dine({ total: 120, subtotal: 120, cashGiven: 100, paidTotal: 100 }),         // items added after paying: 100 cash + 20 unpaid
  del({}),                                                                     // cash delivery 110 (fee 40 is the rider's)
  del({ payment: "GCash", paymentConfirmed: true }),                           // QR delivery confirmed 110
  del({ payment: "GCash" }),                                                   // QR delivery not confirmed 110 unpaid
  del({ payment: "GCash", paymentConfirmed: true, preorder: true }),           // pre-order 110
  dine({ source: "foodpanda", payment: "Foodpanda", paid: true, total: 98, subtotal: 78, boxFee: 20 }),
  dine({ source: "foodpanda", payment: "Foodpanda", paid: true, status: "preparing", total: 98, subtotal: 78, boxFee: 20 }),
  dine({ source: "grab", payment: "Grab", paid: true, total: 49, subtotal: 39, boxFee: 10 }),
  dine({ manual: true, source: "loyverse", cashGiven: 300, total: 300, subtotal: 300 }),  // Loyverse import, cash
];
const b = salesBreakdown(orders, 150);
console.log("Owner sales breakdown");
t("dine-in & take-out: 5 orders, ₱720", b.kinds.dine.count === 5 && b.kinds.dine.amount === 720);
t("Lugaw Delights delivery: 3 orders, ₱330 (rider fees left out)", b.kinds.delivery.count === 3 && b.kinds.delivery.amount === 330);
t("rider fees shown apart: ₱160", b.riderFees === 160);
t("pre-orders: 1, ₱110", b.kinds.preorder.count === 1 && b.kinds.preorder.amount === 110);
t("Foodpanda: 2 orders ₱196 (also the one not marked served)", b.kinds.foodpanda.count === 2 && b.kinds.foodpanda.amount === 196);
t("Grab: 1 order ₱49", b.kinds.grab.count === 1 && b.kinds.grab.amount === 49);
t("total sales = the sold-through lines", b.total === 720 + 330 + 110 + 196 + 49 && b.count === orders.length);
t("cash ₱610 (dine-in 100 + 100 of the changed order + delivery 110 + Loyverse 300)", b.money.cash === 610);
t("GCash ₱320 (dine-in 100 + 2 confirmed QR)", b.money.gcash === 320);
t("Foodpanda / Grab ₱245", b.money.platform === 245);
t("not paid yet ₱230 (served unpaid 100 + 20 balance + QR not confirmed 110)", b.money.unpaid === 230);
t("total sales = cash + GCash + Foodpanda / Grab + not paid yet", b.total === b.money.cash + b.money.gcash + b.money.platform + b.money.unpaid);
t("cash left after the ₱150 pay out", b.cashLeft === 460);
t("a payment never counts twice", orders.every(o => { const p = salePayment(o); return p.cash + p.gcash + p.platform + p.unpaid === (o.total - (o.deliveryFee || 0)); }));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
