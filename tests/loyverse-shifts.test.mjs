// Loyverse import -> past shifts: the shifts' totals are the same as the orders' (no server needed)
import { readLoyverse } from "../public/loyverse.js";
import { findShifts, pastSummary } from "../public/pastshifts.js";

let pass = 0, fail = 0;
const t = (n, ok) => { if (ok) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n); } };
const ITEMS = { L01: { id: "L01", name: "Plain Lugaw", price: 39 } };
const head = "Date,Receipt number,Receipt type,Item,SKU,Quantity,Net sales,Dining option,Status";
const csv = [head,
  "9/10/26 8:05 AM,1-1001,Sale,Plain Lugaw,,2,78,Dine in,Closed",
  "9/10/26 8:20 AM,1-1002,Sale,Plain Lugaw,,1,39,Take out,Closed",
  "9/10/26 8:20 AM,1-1002,Sale,Take out bowl,,1,10,Take out,Closed",
  "9/10/26 9:10 AM,1-1003,Sale,Plain Lugaw,,3,117,Dine in,Closed",
  "9/10/26 9:15 AM,1-1004,Refund,Plain Lugaw,,-1,-39,Dine in,Closed",
  "9/10/26 8:00 PM,1-1005,Sale,Plain Lugaw,,4,156,Delivery,Closed",
  "9/10/26 8:00 PM,1-1005,Sale,Delivery fee,,1,40,Delivery,Closed",
  "9/10/26 9:30 PM,1-1006,Sale,Plain Lugaw,,1,39,Dine in,Closed",
  "9/10/26 9:40 PM,1-1007,Sale,Plain Lugaw,,1,39,Dine in,Cancelled"].join("\n");

console.log("Loyverse receipts and past shifts");
const r = readLoyverse(csv, ITEMS);
t("refund taken off the sale it refunded; cancelled receipt left out", r.orders.length === 5 && r.orders.find(o => o.receipt === "1-1003").total === 78);
t("take-out bowl becomes the box fee", r.orders.find(o => o.receipt === "1-1002").boxFee === 10);
t("delivery line becomes the delivery fee", r.orders.find(o => o.receipt === "1-1005").deliveryFee === 40);
// saved the way the owner's import saves them
const orders = r.orders.map((o, i) => ({ id: "loyverse-" + o.receipt, createdAt: o.when.getTime(), status: "completed", total: o.total,
  deliveryFee: o.deliveryFee, payment: "Cash", manual: true, source: "loyverse" }));
const shop = list => list.filter(o => o.status !== "cancelled").reduce((n, o) => n + o.total - o.deliveryFee, 0);
const shifts = findShifts(orders, { gapHours: 3 });
t("two shifts: morning and evening", shifts.length === 2);
t("every order is in exactly one shift", shifts.flatMap(s => s.ids).sort().join() === orders.map(o => o.id).sort().join());
t("shift sales add up to the orders' sales", shifts.reduce((n, s) => n + s.summary.sales, 0) === shop(orders));
t("Loyverse sales count as the shop's own sales (cash), not Foodpanda / Grab", shifts.every(s => s.summary.platformSales === 0 && s.summary.cashSales === s.summary.sales));
// the owner's view works a past shift out again from the orders in its time
const inShift = (s, list) => list.filter(o => o.createdAt >= s.start.getTime() && o.createdAt <= s.end.getTime());
t("worked out again from the orders: the same totals", shifts.every(s => JSON.stringify(pastSummary(inShift(s, orders))) === JSON.stringify(s.summary)));
const after = orders.filter(o => o.id !== "loyverse-1-1001").concat([{ id: "hand", createdAt: new Date(2026, 8, 10, 20, 45).getTime(), status: "completed", total: 78, deliveryFee: 0, payment: "GCash", paid: true, manual: true }]);
const now = shifts.map(s => pastSummary(inShift(s, after)));
t("after a receipt is deleted and a sale added: shifts still add up to the orders", now.reduce((n, s) => n + s.sales, 0) === shop(after));
t("the added GCash sale shows as GCash", now[1].gcashSales === 78);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
