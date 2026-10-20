// Dine-in GCash: the seller taps "GCash received"; a Ref No. is optional, but must look right if given.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" }));
const s1 = as("s1");
const dine = over => ({ code: "LD-D", customerUid: "s1", sellerUid: "s1", sellerName: "S", mode: "Dine-in", table: "Juan", notes: "", payment: "GCash",
  items: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 2 }], subtotal: 78, deliveryFee: 0, total: 78, status: "preparing", riderUid: null, createdAt: serverTimestamp(), ...over });
const now = { paid: true, paidAt: serverTimestamp() };

await t("GCash dine-in, pay later (no Ref No. yet)", () => assertSucceeds(setDoc(doc(s1, "orders/g1"), dine())));
await t("GCash dine-in paid now with its Ref No.", () => assertSucceeds(setDoc(doc(s1, "orders/g2"), dine({ ...now, gcashRef: "1234567890123" }))));
await t("paid now without a Ref No. (seller tapped GCash received)", () => assertSucceeds(setDoc(doc(s1, "orders/g3"), dine(now))));
await t("paid now with a too-short Ref No. refused", () => assertFails(setDoc(doc(s1, "orders/g4"), dine({ ...now, gcashRef: "123" }))));
await t("a Ref No. without marking paid refused", () => assertFails(setDoc(doc(s1, "orders/g5"), dine({ gcashRef: "1234567890123" }))));
await t("cash order can't be marked GCash-paid", () => assertFails(setDoc(doc(s1, "orders/g6"), dine({ payment: "Cash", ...now, gcashRef: "1234567890123" }))));
await t("pay-later order paid on the card with its Ref No.", () => assertSucceeds(updateDoc(doc(s1, "orders/g1"), { ...now, gcashRef: "9876543210123" })));
await t("a paid order can't be paid again", () => assertFails(updateDoc(doc(s1, "orders/g2"), { ...now, gcashRef: "5555555555555" })));
await t("the Ref No. on a paid order can't be edited", () => assertFails(updateDoc(doc(s1, "orders/g2"), { gcashRef: "5555555555555" })));
await t("a Ref No. can't be added later to an order paid without one", () => assertFails(updateDoc(doc(s1, "orders/g3"), { gcashRef: "5555555555555" })));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/g7"), { ...dine(), createdAt: new Date() }));
await t("pay-later order marked GCash received with one tap (no Ref No.)", () => assertSucceeds(updateDoc(doc(s1, "orders/g7"), now)));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/c7"), { ...dine({ payment: "Cash" }), createdAt: new Date() }));
await t("cash dine-in can't be marked GCash received", () => assertFails(updateDoc(doc(s1, "orders/c7"), now)));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/o7"), { ...dine(), mode: "Pickup", createdAt: new Date() }));
await t("online order can't use the dine-in GCash received", () => assertFails(updateDoc(doc(s1, "orders/o7"), now)));

// Cancelling a served dine-in order (e.g. the customer left without paying)
const cancel = id => updateDoc(doc(s1, "orders", id), { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: "shop", cancelReason: "Customer left without paying" });
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/u1"), { ...dine(), status: "completed", createdAt: new Date() }));
await t("served but unpaid order can be cancelled", () => assertSucceeds(cancel("u1")));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/u2"), { ...dine({ payment: "Cash" }), status: "completed", cashGiven: 100, createdAt: new Date() }));
await t("cash-paid order can't be cancelled", () => assertFails(cancel("u2")));
await t("GCash-paid order can't be cancelled", () => assertFails(cancel("g2")));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
