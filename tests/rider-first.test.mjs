// Delivery orders find a rider first; the store cooks once a rider has accepted.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const seed = f => env.withSecurityRulesDisabled(c => f(c.firestore()));
const PAY = { payMethod: "GCash", payName: "R", payNumber: "09171234567", payBank: "" };
const order = over => ({ code: "LD-1", customerUid: "cust", mode: "Delivery", payment: "Cash", items: [], subtotal: 78, deliveryFee: 40, total: 118, status: "new", riderUid: null, ...over });
await seed(async db => {
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  for (const r of ["r1", "r2"]) {
    await setDoc(doc(db, "riders", r), { name: r, phone: "0917000000" + r.slice(1), status: "approved", online: true, ...PAY });
    await setDoc(doc(db, "agreements", r), { version: "x" });
  }
  await setDoc(doc(db, "orders/d1"), order());
  await setDoc(doc(db, "orders/p1"), order({ mode: "Pickup", deliveryFee: 0, total: 78 }));
});
const s1 = as("s1"), r1 = as("r1"), r2 = as("r2");
const take = (r, id, status) => updateDoc(doc(as(r), "orders", id), { status, riderUid: r, riderName: r, riderPhone: "0917000000" + r.slice(1), assignedAt: serverTimestamp() });
const giveBack = (who, id, status) => updateDoc(doc(who, "orders", id), { status, riderUid: null, riderName: null, riderPhone: null, assignedAt: null });

console.log("New delivery order: riders first");
await t("riders can see a new delivery order", () => assertSucceeds(getDoc(doc(r1, "orders/d1"))));
await t("riders can't see a pickup order", () => assertFails(getDoc(doc(r1, "orders/p1"))));
await t("store can't cook it before a rider accepts", () => assertFails(updateDoc(doc(s1, "orders/d1"), { status: "preparing" })));
await t("store can still cancel it (no rider available)", async () => {
  await seed(db => setDoc(doc(db, "orders/d0"), order()));
  await assertSucceeds(updateDoc(doc(s1, "orders/d0"), { status: "cancelled", cancelledBy: "shop", cancelReason: "No rider available right now" }));
});
await t("a rider can't skip straight to cooking", () => assertFails(take("r1", "d1", "preparing")));
await t("rider accepts: order becomes \"rider found\"", () => assertSucceeds(take("r1", "d1", "assigned")));
await t("a second rider can't take it", () => assertFails(take("r2", "d1", "assigned")));
await t("rider gives it back before cooking: it looks for a rider again", () => assertSucceeds(giveBack(r1, "d1", "new")));
await t("rider accepts again", () => assertSucceeds(take("r1", "d1", "assigned")));
await t("store starts cooking once a rider has accepted", () => assertSucceeds(updateDoc(doc(s1, "orders/d1"), { status: "preparing" })));

console.log("Rider drops out after cooking started");
await t("rider gives it back while cooking: it stays in the kitchen", () => assertSucceeds(giveBack(r1, "d1", "preparing")));
await t("giving it back can't restart the rider search", () => assertFails(updateDoc(doc(s1, "orders/d1"), { status: "new" })));
await t("another rider takes the cooking order (status stays preparing)", () => assertSucceeds(take("r2", "d1", "preparing")));
await t("store marks the food ready", () => assertSucceeds(updateDoc(doc(s1, "orders/d1"), { status: "ready" })));
await t("store sends it back to riders while ready", () => assertSucceeds(giveBack(s1, "d1", "ready")));
await t("a rider takes the ready order (status stays ready)", () => assertSucceeds(take("r1", "d1", "ready")));
await t("store confirms the rider paid and hands over the food", () => assertSucceeds(updateDoc(doc(s1, "orders/d1"), { status: "picked_up", pickedUpAt: serverTimestamp(), riderPaid: true, riderPaidAt: serverTimestamp(), cashReceived: true })));

console.log("Pickup orders are unchanged");
await t("store cooks a pickup order right away", () => assertSucceeds(updateDoc(doc(s1, "orders/p1"), { status: "preparing" })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
