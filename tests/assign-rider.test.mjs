// The seller gives a waiting delivery to a rider (after calling them): only to an approved rider who
// signed the agreement and has a payout account, with their real name and number.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

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
  await setDoc(doc(db, "sellers/s1"), { name: "Ana", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "riders/r1"), { name: "Rico", phone: "09170000011", status: "approved", online: false, ...PAY });
  await setDoc(doc(db, "agreements/r1"), { version: "x" });
  await setDoc(doc(db, "riders/r2"), { name: "Ben", phone: "09170000012", status: "approved", online: true, ...PAY }); // no agreement
  await setDoc(doc(db, "riders/r3"), { name: "Cy", phone: "09170000013", status: "pending", ...PAY });
  await setDoc(doc(db, "agreements/r3"), { version: "x" });
  for (const id of ["a1", "a2", "a3", "a4", "a5", "a6"]) await setDoc(doc(db, "orders", id), order());
});
const s1 = as("s1"), r1 = as("r1");
const give = (who, id, r, over = {}) => updateDoc(doc(who, "orders", id), { status: "assigned", riderUid: r.id, riderName: r.name, riderPhone: r.phone,
  assignedAt: serverTimestamp(), assignedBy: "s1", assignedByName: "Ana", ...over });
const RICO = { id: "r1", name: "Rico", phone: "09170000011" };

console.log("Seller assigns a rider");
await t("seller assigns a waiting delivery to a rider who signed the agreement", () => assertSucceeds(give(s1, "a1", RICO)));
await t("the rider app sees it as theirs", () => assertSucceeds(updateDoc(doc(r1, "orders/a1"), { status: "new", riderUid: null, riderName: null, riderPhone: null, assignedAt: null, assignedBy: null, assignedByName: null })));
await t("a rider without the signed agreement can't be assigned", () => assertFails(give(s1, "a2", { id: "r2", name: "Ben", phone: "09170000012" })));
await t("a rider not approved can't be assigned", () => assertFails(give(s1, "a3", { id: "r3", name: "Cy", phone: "09170000013" })));
await t("a wrong rider name refused", () => assertFails(give(s1, "a4", { ...RICO, name: "Someone else" })));
await t("it must say who assigned it", () => assertFails(give(s1, "a5", RICO, { assignedBy: "other" })));
await t("a delivery a rider already took can't be reassigned this way", async () => {
  await seed(db => setDoc(doc(db, "orders/a6"), order({ status: "assigned", riderUid: "r2", riderName: "Ben", riderPhone: "09170000012" })));
  await assertFails(give(s1, "a6", RICO));
});
await t("a customer can't assign a rider", () => assertFails(give(as("cust", "anonymous"), "a4", RICO, { assignedBy: "cust" })));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
