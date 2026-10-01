import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp, Timestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "settings/delivery"), { fees: { "lb-anos": 40 } }));
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const seed = f => env.withSecurityRulesDisabled(c => f(c.firestore()));
await seed(async db => {
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "riders/r1"), { name: "Rider One", phone: "09171234567", payMethod: "GCash", payName: "Rider", payNumber: "09171234567", payBank: "", status: "approved", online: true });
  await setDoc(doc(db, "riders/r2"), { name: "Rider Two", phone: "09179999999", payMethod: "GCash", payName: "Rider", payNumber: "09171234567", payBank: "", status: "approved", online: true });
});
let n = 0;
function place(uid, mode, { pin, withPin = true } = {}) {
  const db = as(uid, "anonymous"), b = writeBatch(db), id = "o" + (++n);
  const fee = mode === "Delivery" ? 40 : 0;
  b.set(doc(db, "orders", id), { code: "LD-" + n, customerUid: uid, mode, address: mode === "Delivery" ? "St" : "", notes: "", payment: "Cash",
    items: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 2 }], ...(mode === "Delivery" ? { zone: "lb-anos", zoneName: "Anos, Los Baños" } : {}), subtotal: 78, deliveryFee: fee, total: 78 + fee,
    status: "new", riderUid: null, createdAt: serverTimestamp(), ...(mode === "Delivery" && withPin ? { hasPin: true } : {}) });
  b.set(doc(db, "contacts", id), { name: "J", phone: "09170001111", customerUid: uid, createdAt: serverTimestamp() });
  b.set(doc(db, "customers", uid), { lastOrderAt: serverTimestamp(), lastOrderId: id });
  if (withPin) b.set(doc(db, "pins", id), { pin: pin ?? "4821", customerUid: uid });
  return { id, done: b.commit() };
}
console.log("Placing orders");
await t("delivery order without a PIN refused", () => assertFails(place("a1", "Delivery", { withPin: false }).done));
await t("delivery order marked hasPin but missing its PIN refused", () => { const db = as("a0", "anonymous"), b = writeBatch(db);
  b.set(doc(db, "orders/x0"), { code: "LD-X", customerUid: "a0", mode: "Delivery", address: "St", notes: "", payment: "Cash", items: [{ id: "L01", name: "P", price: 39, qty: 2 }], zone: "lb-anos", zoneName: "Anos, Los Baños", subtotal: 78, deliveryFee: 40, total: 118, status: "new", riderUid: null, createdAt: serverTimestamp(), hasPin: true });
  b.set(doc(db, "contacts/x0"), { name: "J", phone: "09170001111", customerUid: "a0", createdAt: serverTimestamp() });
  b.set(doc(db, "customers/a0"), { lastOrderAt: serverTimestamp(), lastOrderId: "x0" });
  return assertFails(b.commit()); });
await t("delivery order with a 3-digit PIN refused", () => assertFails(place("a2", "Delivery", { pin: "123" }).done));
await t("delivery order with letters in PIN refused", () => assertFails(place("a3", "Delivery", { pin: "12a4" }).done));
const good = place("cust", "Delivery");
await t("delivery order with a PIN works", () => assertSucceeds(good.done));
await t("pickup order needs no PIN", () => assertSucceeds(place("a4", "Pickup", { withPin: false }).done));

console.log("Who can see the PIN");
await t("customer reads their PIN", () => assertSucceeds(getDoc(doc(as("cust", "anonymous"), "pins", good.id))));
await t("seller reads the PIN", () => assertSucceeds(getDoc(doc(as("s1"), "pins", good.id))));
await t("rider can't read the PIN", () => assertFails(getDoc(doc(as("r1"), "pins", good.id))));
await t("customer can't change their PIN later", () => assertFails(updateDoc(doc(as("cust", "anonymous"), "pins", good.id), { pin: "0000" })));

console.log("Delivering");
await seed(db => updateDoc(doc(db, "orders", good.id), { status: "picked_up", riderUid: "r1", riderName: "Rider One", riderPhone: "09171234567" }));
const r1 = as("r1"), deliver = pin => updateDoc(doc(r1, "orders", good.id),
  { status: "delivered", deliveredAt: serverTimestamp(), deliveredDate: "2026-09-30", settled: false, ...(pin === undefined ? {} : { pinEntered: pin }) });
await t("rider without the code refused", () => assertFails(deliver()));
await t("rider with the wrong code refused", () => assertFails(deliver("1111")));
await t("rider with the right code delivers", () => assertSucceeds(deliver("4821")));
await seed(db => setDoc(doc(db, "orders/legacy"), { code: "LD-OLD", customerUid: "old", mode: "Delivery", status: "picked_up", riderUid: "r1", total: 118, createdAt: Timestamp.now() }));
await t("older order without a PIN can still be delivered", () => assertSucceeds(updateDoc(doc(r1, "orders/legacy"), { status: "delivered", deliveredAt: serverTimestamp(), deliveredDate: "2026-09-30", settled: false, pinEntered: "" })));
const p2 = place("cust2", "Delivery", { pin: "7777" }); await p2.done;
await seed(db => updateDoc(doc(db, "orders", p2.id), { status: "picked_up", riderUid: "r1" }));
const shopDeliver = who => updateDoc(doc(as(who), "orders", p2.id), { status: "delivered", deliveredAt: serverTimestamp(), deliveredDate: "2026-09-30", settled: false });
await t("seller can't mark a delivery delivered", () => assertFails(shopDeliver("s1")));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "admins/owner"), { name: "Owner" }));
await t("owner can't mark a delivery delivered", () => assertFails(shopDeliver("owner")));
await t("seller can read the code to help the rider", () => assertSucceeds(getDoc(doc(as("s1"), "pins", p2.id))));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/pk"), { code: "LD-PK", customerUid: "c", mode: "Pickup", status: "ready_pickup", total: 78 }));
await t("seller still marks a pickup order collected", () => assertSucceeds(updateDoc(doc(as("s1"), "orders/pk"), { status: "completed", completedAt: serverTimestamp() })));
await t("rider delivers it with the code", () => assertSucceeds(updateDoc(doc(r1, "orders", p2.id), { status: "delivered", deliveredAt: serverTimestamp(), deliveredDate: "2026-10-01", settled: false, pinEntered: "7777" })));

console.log("Reports");
const rep = (db, id, over = {}) => setDoc(doc(db, "reports", id), { orderId: id, code: "LD-1", customerUid: "cust", riderUid: "r1", riderName: "Rider One",
  mode: "Delivery", reason: "I didn't receive my food", details: "", status: "open", createdAt: serverTimestamp(), ...over });
const cust = as("cust", "anonymous");
await t("report blaming a different rider refused", () => assertFails(rep(cust, good.id, { riderUid: "r2" })));
await t("report with no reason refused", () => assertFails(rep(cust, good.id, { reason: "" })));
await t("someone else can't report this order", () => assertFails(rep(as("stranger", "anonymous"), good.id, { customerUid: "stranger" })));
await t("customer reports a problem", () => assertSucceeds(rep(cust, good.id)));
await t("customer can't send a second report for the same order", () => assertFails(rep(cust, good.id, { reason: "Something else" })));
await t("customer reads their report", () => assertSucceeds(getDoc(doc(cust, "reports", good.id))));
await t("rider can't read reports", () => assertFails(getDoc(doc(r1, "reports", good.id))));
await t("seller can't read reports", () => assertFails(getDoc(doc(as("s1"), "reports", good.id))));
await t("owner reads the report", () => assertSucceeds(getDoc(doc(as("owner"), "reports", good.id))));
await t("owner marks it resolved", () => assertSucceeds(updateDoc(doc(as("owner"), "reports", good.id), { status: "resolved" })));
await t("pickup order report (no rider)", async () => { const p = place("cust3", "Pickup", { withPin: false }); await p.done;
  await assertSucceeds(rep(as("cust3", "anonymous"), p.id, { customerUid: "cust3", riderUid: null, riderName: null, mode: "Pickup", reason: "Wrong or missing items" })); });

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
