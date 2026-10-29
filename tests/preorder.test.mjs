// Pre-orders (platters, party packages): paid in full by QR, and only accepted once the seller has
// confirmed the payment arrived.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "settings/delivery"), { fees: { "lb-anos": 40 } });
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
});
let n = 0;
function place(payment, over = {}) {
  const uid = "c" + (++n), db = as(uid, "anonymous"), b = writeBatch(db), id = "o" + n;
  const data = { code: "LD-" + n, customerUid: uid, mode: "Delivery", address: "St", notes: "", payment,
    items: [{ id: "P03", name: "Shanghai platter", price: 499, qty: 1 }], zone: "lb-anos", zoneName: "Anos, Los Baños", subtotal: 499, deliveryFee: 40, total: 539,
    status: "new", riderUid: null, createdAt: serverTimestamp(), preorder: true, ...over };
  if (data.preorder === undefined) delete data.preorder;
  b.set(doc(db, "orders", id), data);
  b.set(doc(db, "contacts", id), { name: "J", phone: "09170001111", customerUid: uid, createdAt: serverTimestamp() });
  b.set(doc(db, "customers", uid), { lastOrderAt: serverTimestamp(), lastOrderId: id });
  return b.commit();
}
console.log("Pre-orders");
await t("pre-order paid by QR allowed", () => assertSucceeds(place("GCash")));
await t("pre-order with cash on delivery refused", () => assertFails(place("Cash")));
await t("preorder flag must be true", () => assertFails(place("GCash", { preorder: "yes" })));
await t("ordinary order without the flag still allowed", () => assertSucceeds(place("Cash", { preorder: undefined })));
await t("pre-order with the delivery day and time the customer picked", () => assertSucceeds(place("GCash", { deliverOn: "2026-11-05", deliverTime: "11:30" })));
await t("a delivery day that isn't a date refused", () => assertFails(place("GCash", { deliverOn: "next friday" })));
await t("a delivery day on an ordinary order refused", () => assertFails(place("Cash", { preorder: undefined, deliverOn: "2026-11-05" })));
await t("a time without a day refused", () => assertFails(place("GCash", { deliverTime: "11:30" })));

const s1 = as("s1");
const assigned = (id, over) => env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders", id), { code: "LD-" + id, customerUid: "cx", mode: "Delivery",
  address: "St", notes: "", payment: "GCash", items: [{ id: "P03", name: "Shanghai platter", price: 499, qty: 1 }], zone: "lb-anos", subtotal: 499, deliveryFee: 40, total: 539,
  status: "assigned", riderUid: "r1", createdAt: new Date(), payShotAt: new Date(), ...over }));
await assigned("p1", { preorder: true });
await t("seller can't accept a pre-order with only the screenshot", () => assertFails(updateDoc(doc(s1, "orders/p1"), { status: "preparing", preparingAt: serverTimestamp(), sellerUid: "s1", sellerName: "S" })));
await t("seller confirms the payment arrived", () => assertSucceeds(updateDoc(doc(s1, "orders/p1"), { paymentConfirmed: true, paymentConfirmedAt: serverTimestamp() })));
await t("then the seller can accept it", () => assertSucceeds(updateDoc(doc(s1, "orders/p1"), { status: "preparing", preparingAt: serverTimestamp(), sellerUid: "s1", sellerName: "S" })));
await t("the pre-order mark can't be removed", () => assertFails(updateDoc(doc(s1, "orders/p1"), { preorder: false })));
await t("the seller can't change the delivery day", () => assertFails(updateDoc(doc(s1, "orders/p1"), { deliverOn: "2026-12-01" })));
await assigned("p2", {});
await t("an ordinary QR order is still accepted with the screenshot", () => assertSucceeds(updateDoc(doc(s1, "orders/p2"), { status: "preparing", preparingAt: serverTimestamp(), sellerUid: "s1", sellerName: "S" })));

console.log("Scheduled pre-orders (held until the delivery day)");
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "riders/r1"), { name: "r1", phone: "09170000009", status: "approved", online: true, payMethod: "GCash", payName: "R", payNumber: "09171234567", payBank: "" });
  await setDoc(doc(db, "agreements/r1"), { version: "x" });
});
await t("customer's pre-order is saved as scheduled", () => assertSucceeds(place("GCash", { status: "scheduled", deliverOn: "2026-11-05" })));
await t("an ordinary order can't be scheduled", () => assertFails(place("Cash", { preorder: undefined, status: "scheduled" })));
const sched = (id, over) => assigned(id, { preorder: true, status: "scheduled", riderUid: null, deliverOn: "2026-11-05", ...over });
const r1 = as("r1");
await sched("h1", {});
await t("riders can't see a scheduled pre-order", () => assertFails(getDoc(doc(r1, "orders/h1"))));
await t("riders can't take a scheduled pre-order", () => assertFails(updateDoc(doc(r1, "orders/h1"), { status: "assigned", riderUid: "r1", riderName: "r1", riderPhone: "09170000009", assignedAt: serverTimestamp() })));
await t("seller can't send it to riders before it's paid", () => assertFails(updateDoc(doc(s1, "orders/h1"), { status: "new", releasedAt: serverTimestamp() })));
await t("seller can't skip to cooking", () => assertFails(updateDoc(doc(s1, "orders/h1"), { status: "preparing", paymentConfirmed: true })));
await t("seller confirms the payment", () => assertSucceeds(updateDoc(doc(s1, "orders/h1"), { paymentConfirmed: true, paymentConfirmedAt: serverTimestamp() })));
await t("then sends it to riders on the day", () => assertSucceeds(updateDoc(doc(s1, "orders/h1"), { status: "new", releasedAt: serverTimestamp() })));
await t("now riders can see it", () => assertSucceeds(getDoc(doc(r1, "orders/h1"))));
await sched("h2", { customerUid: "c99" });
await t("customer cancels an unpaid scheduled pre-order", () => assertSucceeds(updateDoc(doc(as("c99", "anonymous"), "orders/h2"), { status: "cancelled", cancelledBy: "customer" })));
await sched("h3", { customerUid: "c98", paymentConfirmed: true });
await t("a paid one can't be cancelled by the customer (call the shop)", () => assertFails(updateDoc(doc(as("c98", "anonymous"), "orders/h3"), { status: "cancelled", cancelledBy: "customer" })));
await t("the seller can cancel it", () => assertSucceeds(updateDoc(doc(s1, "orders/h3"), { status: "cancelled", cancelReason: "Customer asked" })));

console.log("Payment not received (wrong or fake screenshot)");
await assigned("x1", { payShotAt: new Date(Date.now() - 60000) });
await t("seller marks the screenshot as not received", () => assertSucceeds(updateDoc(doc(s1, "orders/x1"), { payRejectedAt: serverTimestamp() })));
await t("then the order can't be cooked", () => assertFails(updateDoc(doc(s1, "orders/x1"), { status: "preparing", preparingAt: serverTimestamp(), sellerUid: "s1", sellerName: "S" })));
await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), "orders/x1"), { payShotAt: new Date(Date.now() + 5000) })); // the customer sends a new screenshot
await t("after a new screenshot it can be cooked again", () => assertSucceeds(updateDoc(doc(s1, "orders/x1"), { status: "preparing", preparingAt: serverTimestamp(), sellerUid: "s1", sellerName: "S" })));
await assigned("x2", { paymentConfirmed: true });
await t("a confirmed payment can't be marked not received", () => assertFails(updateDoc(doc(s1, "orders/x2"), { payRejectedAt: serverTimestamp() })));
await assigned("x3", { payment: "Cash", payShotAt: null });
await t("a cash order can't be marked not received", () => assertFails(updateDoc(doc(s1, "orders/x3"), { payRejectedAt: serverTimestamp() })));
await assigned("x4", {});
await t("the time must be now", () => assertFails(updateDoc(doc(s1, "orders/x4"), { payRejectedAt: new Date(2020, 0, 1) })));

console.log("Pre-order picked up at the shop");
const noZone = o => { const d = { ...o }; delete d.zone; delete d.zoneName; return d; };
function placePick(payment, over = {}) {
  const uid = "c" + (++n), db = as(uid, "anonymous"), b = writeBatch(db), id = "o" + n;
  const data = noZone({ code: "LD-" + n, customerUid: uid, mode: "Pickup", address: "", notes: "", payment,
    items: [{ id: "P03", name: "Shanghai platter", price: 499, qty: 1 }], subtotal: 499, deliveryFee: 0, total: 499,
    status: "scheduled", riderUid: null, createdAt: serverTimestamp(), preorder: true, deliverOn: "2026-11-05", ...over });
  Object.keys(data).forEach(k => { if (data[k] === undefined) delete data[k]; }); // left out, not sent
  b.set(doc(db, "orders", id), data);
  b.set(doc(db, "contacts", id), { name: "J", phone: "09170001111", customerUid: uid, createdAt: serverTimestamp() });
  b.set(doc(db, "customers", uid), { lastOrderAt: serverTimestamp(), lastOrderId: id });
  return b.commit();
}
await t("a pre-order for pickup at the shop allowed", () => assertSucceeds(placePick("GCash")));
await t("a pickup pre-order still can't be cash", () => assertFails(placePick("Cash")));
await t("an ordinary order can't be pickup", () => assertFails(placePick("GCash", { preorder: undefined, status: "new", deliverOn: undefined })));
await t("a pickup pre-order has no delivery fee", () => assertFails(placePick("GCash", { deliveryFee: 40, total: 539 })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
