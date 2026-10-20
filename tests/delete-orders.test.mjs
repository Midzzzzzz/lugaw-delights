// Only the owner deletes orders (with their contact details and delivery code).
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, deleteDoc, Timestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "riders/r1"), { name: "R", phone: "09170000003", status: "approved", online: true });
  for (const id of ["o1", "o2"]) {
    await setDoc(doc(db, "orders", id), { code: "LD-T", customerUid: "cust", mode: "Delivery", status: "delivered", items: [], subtotal: 78, deliveryFee: 40, total: 118, payment: "Cash", riderUid: "r1", createdAt: Timestamp.now() });
    await setDoc(doc(db, "contacts", id), { name: "Juan", phone: "09170001111", customerUid: "cust" });
    await setDoc(doc(db, "pins", id), { pin: "1234", customerUid: "cust" });
  }
});
const owner = as("owner"), s1 = as("s1"), r1 = as("r1"), cust = as("cust", "anonymous");

await t("seller can't delete an order", () => assertFails(deleteDoc(doc(s1, "orders/o1"))));
await t("rider can't delete an order", () => assertFails(deleteDoc(doc(r1, "orders/o1"))));
await t("customer can't delete their order", () => assertFails(deleteDoc(doc(cust, "orders/o1"))));
await t("customer can't delete the delivery code", () => assertFails(deleteDoc(doc(cust, "pins/o1"))));
await t("seller can't delete contact details", () => assertFails(deleteDoc(doc(s1, "contacts/o1"))));
await t("owner deletes an order", () => assertSucceeds(deleteDoc(doc(owner, "orders/o1"))));
await t("owner deletes its contact details", () => assertSucceeds(deleteDoc(doc(owner, "contacts/o1"))));
await t("owner deletes its delivery code", () => assertSucceeds(deleteDoc(doc(owner, "pins/o1"))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
