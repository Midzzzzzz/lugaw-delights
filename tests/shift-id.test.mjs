// Every order is saved with the shift open when it's punched (settings/store.shiftId), so a shift's
// orders are the ones recorded during it. Only the shift a seller is opening can be put on the store.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, writeBatch, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "sellers/s1"), { name: "Teodora", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "settings/delivery"), { fees: { "lb-anos": 40 } });
  await setDoc(doc(db, "shifts/old"), { openedAt: new Date(Date.now() - 86400000), openedBy: "s1", openedByName: "Teodora", startCash: 0, moves: [], closedAt: new Date() });
});
const s1 = as("s1");
const dine = over => ({ code: "LD-D", customerUid: "s1", sellerUid: "s1", sellerName: "Teodora", mode: "Dine-in", table: "", notes: "", payment: "Cash",
  items: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 1 }], subtotal: 39, deliveryFee: 0, total: 39, status: "preparing", riderUid: null, createdAt: serverTimestamp(), ...over });

console.log("Opening a shift puts it on the store");
await t("seller opens a shift and the store names it", () => { const b = writeBatch(s1);
  b.set(doc(s1, "shifts/teo"), { openedAt: serverTimestamp(), openedBy: "s1", openedByName: "Teodora", startCash: 0, moves: [], closedAt: null });
  b.set(doc(s1, "settings/store"), { open: true, shiftId: "teo" }, { merge: true }); return assertSucceeds(b.commit()); });
await t("the store can't name a shift that's closed", () => assertFails(setDoc(doc(s1, "settings/store"), { open: true, shiftId: "old" }, { merge: true })));
await t("or one that doesn't exist", () => assertFails(setDoc(doc(s1, "settings/store"), { open: true, shiftId: "nope" }, { merge: true })));

console.log("Orders are saved with the open shift");
await t("a counter order saved with the open shift", () => assertSucceeds(setDoc(doc(s1, "orders/d1"), dine({ shiftId: "teo" }))));
await t("not with another shift", () => assertFails(setDoc(doc(s1, "orders/d2"), dine({ shiftId: "old" }))));
const cust = as("c1", "anonymous");
const online = over => { const b = writeBatch(cust);
  b.set(doc(cust, "orders/o1"), { code: "LD-O", customerUid: "c1", mode: "Delivery", address: "St", notes: "", payment: "Cash", zone: "lb-anos", zoneName: "Anos",
    items: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 1 }], subtotal: 39, deliveryFee: 40, total: 79, status: "new", riderUid: null, createdAt: serverTimestamp(), ...over });
  b.set(doc(cust, "contacts/o1"), { name: "J", phone: "09170001111", customerUid: "c1", createdAt: serverTimestamp() });
  b.set(doc(cust, "customers/c1"), { lastOrderAt: serverTimestamp(), lastOrderId: "o1" }); return b.commit(); };
await t("an online order with the wrong shift refused", () => assertFails(online({ shiftId: "old" })));
await t("an online order saved with the open shift", () => assertSucceeds(online({ shiftId: "teo" })));
await t("the shift on an order can't be changed", () => assertFails(updateDoc(doc(s1, "orders/d1"), { shiftId: "old" })));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/x1"), { ...dine(), status: "new", mode: "Pickup", customerUid: "c9", createdAt: new Date() }));
await t("an order from an older app gets the open shift when the seller takes it on", () => assertSucceeds(updateDoc(doc(s1, "orders/x1"), { status: "preparing", sellerUid: "s1", sellerName: "Teodora", shiftId: "teo" })));

console.log("Closing the shift clears it");
await t("seller closes: the store names no shift", () => assertSucceeds(setDoc(doc(s1, "settings/store"), { open: false, shiftId: null }, { merge: true })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
