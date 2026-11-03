// An online GCash (QR) order is on hold until the customer uploads the screenshot of their payment:
// no rider can accept it and the store can't cook it, and a reference number alone isn't enough.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, writeBatch, serverTimestamp, Timestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const seed = f => env.withSecurityRulesDisabled(c => f(c.firestore()));
const PAY = { payMethod: "GCash", payName: "R", payNumber: "09171234567", payBank: "" };
const order = over => ({ code: "LD-1", customerUid: "cust", mode: "Delivery", payment: "GCash", items: [], subtotal: 78, deliveryFee: 40, total: 118, status: "new", riderUid: null, ...over });
await seed(async db => {
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "riders/r1"), { name: "r1", phone: "09170000001", status: "approved", online: true, ...PAY });
  await setDoc(doc(db, "agreements/r1"), { version: "x" });
  await setDoc(doc(db, "orders/g1"), order());
  await setDoc(doc(db, "orders/g2"), order({ gcashRef: "1234567890123", gcashSender: "Juan", gcashSentAt: Timestamp.fromMillis(1000) }));
  await setDoc(doc(db, "orders/g3"), order({ paymentConfirmed: true }));
  await setDoc(doc(db, "orders/c1"), order({ payment: "Cash" }));
  await setDoc(doc(db, "orders/k1"), order({ mode: "Pickup", deliveryFee: 0, total: 78, gcashRef: "1234567890123", gcashSender: "Juan", gcashSentAt: Timestamp.fromMillis(1000) }));
});
const s1 = as("s1"), cust = as("cust", "anonymous");
const take = id => updateDoc(doc(as("r1"), "orders", id), { status: "assigned", riderUid: "r1", riderName: "r1", riderPhone: "09170000001", assignedAt: serverTimestamp() });
const shot = id => { const b = writeBatch(cust);
  b.set(doc(cust, "payshots", id), { customerUid: "cust", photo: "data:image/jpeg;base64,AAAA", sentAt: serverTimestamp() });
  b.update(doc(cust, "orders", id), { payShotAt: serverTimestamp() }); return b.commit(); };

await t("rider can't accept a GCash order before the screenshot", () => assertFails(take("g1")));
await t("rider can't accept it with only a reference number", () => assertFails(take("g2")));
await t("store can't cook a pickup GCash order with only a reference number", () => assertFails(updateDoc(doc(s1, "orders/k1"), { status: "preparing" })));
await t("rider still accepts a cash order", () => assertSucceeds(take("c1")));
await t("rider accepts a GCash order the shop already confirmed", () => assertSucceeds(take("g3")));
await t("customer uploads the screenshot", () => assertSucceeds(shot("g1")));
await t("rider accepts once the screenshot is in", () => assertSucceeds(take("g1")));
await t("store cooks it once a rider accepted", () => assertSucceeds(updateDoc(doc(s1, "orders/g1"), { status: "preparing" })));
await t("screenshot on the reference-only order lets it go on", async () => { await shot("g2"); await assertSucceeds(take("g2")); });

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
