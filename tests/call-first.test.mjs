// Riders call the customer to confirm a new delivery order is real before accepting it.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const PAY = { payMethod: "GCash", payName: "R", payNumber: "09171234567", payBank: "" };
const order = over => ({ code: "LD-1", customerUid: "cust", mode: "Delivery", payment: "Cash", items: [], subtotal: 78, deliveryFee: 40, total: 118, status: "new", riderUid: null, ...over });
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "riders/r1"), { name: "Rider One", phone: "09170000001", status: "approved", online: true, ...PAY });
  await setDoc(doc(db, "riders/r2"), { name: "Rider Two", phone: "09170000002", status: "approved", online: true, ...PAY });
  await setDoc(doc(db, "agreements/r2"), { version: "x" });
  await setDoc(doc(db, "riders/p1"), { name: "Pending", phone: "09170000003", status: "pending", online: false, ...PAY });
  await setDoc(doc(db, "riders/s1"), { name: "Suspended", phone: "09170000004", status: "suspended", online: false, ...PAY });
  for (const id of ["o1", "o2"]) {
    await setDoc(doc(db, "orders", id), order());
    await setDoc(doc(db, "contacts", id), { name: "Juan", phone: "09175550000", customerUid: "cust" });
  }
  await setDoc(doc(db, "orders/p1"), order({ mode: "Pickup", deliveryFee: 0, total: 78 }));
  await setDoc(doc(db, "contacts/p1"), { name: "Ana", phone: "09175551111", customerUid: "cust" });
  await setDoc(doc(db, "orders/taken"), order({ status: "assigned", riderUid: "r2", riderName: "Rider Two", riderPhone: "09170000002" }));
  await setDoc(doc(db, "contacts/taken"), { name: "Ben", phone: "09175552222", customerUid: "cust" });
});
const r1 = as("r1");
const flag = (who, id, name) => updateDoc(doc(as(who), "orders", id), { unconfirmedAt: serverTimestamp(), unconfirmedBy: who, unconfirmedByName: name });

console.log("Seeing the customer's number before accepting");
await t("approved rider sees the customer of a new delivery order", () => assertSucceeds(getDoc(doc(r1, "contacts/o1"))));
await t("pending rider can't", () => assertFails(getDoc(doc(as("p1"), "contacts/o1"))));
await t("suspended rider can't", () => assertFails(getDoc(doc(as("s1"), "contacts/o1"))));
await t("riders can't see a pickup customer", () => assertFails(getDoc(doc(r1, "contacts/p1"))));
await t("once another rider took it, others can't see the customer", () => assertFails(getDoc(doc(r1, "contacts/taken"))));
await t("the rider who took it still can", () => assertSucceeds(getDoc(doc(as("r2"), "contacts/taken"))));

console.log("Couldn't confirm the customer");
await t("rider flags an order they couldn't confirm", () => assertSucceeds(flag("r1", "o2", "Rider One")));
await t("flag in another rider's name refused", () => assertFails(flag("r1", "o1", "Rider Two")));
await t("flag for another rider's id refused", () => assertFails(updateDoc(doc(r1, "orders/o1"), { unconfirmedAt: serverTimestamp(), unconfirmedBy: "r2", unconfirmedByName: "Rider One" })));
await t("can't flag an order another rider already took", () => assertFails(flag("r1", "taken", "Rider One")));
await t("flagging can't change anything else", () => assertFails(updateDoc(doc(r1, "orders/o1"), { unconfirmedAt: serverTimestamp(), unconfirmedBy: "r1", unconfirmedByName: "Rider One", status: "cancelled" })));
await t("another rider can still accept a flagged order", () => assertSucceeds(updateDoc(doc(as("r2"), "orders/o2"),
  { status: "assigned", riderUid: "r2", riderName: "Rider Two", riderPhone: "09170000002", assignedAt: serverTimestamp() })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
