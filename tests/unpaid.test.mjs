// Dine-in payment is recorded once: cash received (covering the total) or GCash marked received.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteField, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const dine = over => ({ code: "LD-D", customerUid: "s1", sellerUid: "s1", sellerName: "S", mode: "Dine-in", table: "3", notes: "", payment: "Cash",
  items: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 2 }], subtotal: 78, deliveryFee: 0, total: 78, status: "completed", riderUid: null, ...over });
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "orders/c1"), dine());
  await setDoc(doc(db, "orders/g1"), dine({ payment: "GCash" }));
});
const s1 = as("s1"), up = (id, data) => updateDoc(doc(s1, "orders", id), data);

console.log("Cash");
await t("cash less than the total refused", () => assertFails(up("c1", { cashGiven: 50 })));
await t("served table pays ₱100 cash", () => assertSucceeds(up("c1", { cashGiven: 100 })));
await t("cash received can't be changed afterwards", () => assertFails(up("c1", { cashGiven: 78 })));
await t("cash received can't be erased", () => assertFails(up("c1", { cashGiven: deleteField() })));
await t("a paid order can't be changed", () => assertFails(up("c1", { items: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 1 }], subtotal: 39, total: 39,
  removed: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 1, by: "S", at: 1 }], editedAt: serverTimestamp(), editedBy: "s1", editedByName: "S" })));
console.log("GCash");
await t("served table's GCash marked received", () => assertSucceeds(up("g1", { paid: true, paidAt: serverTimestamp() })));
await t("a paid order can't be marked unpaid again", () => assertFails(up("g1", { paid: false })));
await t("a GCash-paid order can't be changed", () => assertFails(up("g1", { items: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 3 }], subtotal: 117, total: 117, status: "preparing", addedAt: serverTimestamp() })));
await t("customer can't mark an order paid", () => assertFails(updateDoc(doc(as("cust", "anonymous"), "orders/c1"), { paid: true })));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
