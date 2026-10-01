import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "anonymous") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const seed = f => env.withSecurityRulesDisabled(c => f(c.firestore()));
const base = { code: "LD-G", customerUid: "cust", mode: "Delivery", status: "new", total: 229, subtotal: 189, deliveryFee: 40, items: [], riderUid: null, createdAt: Timestamp.now() };
await seed(async db => {
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "orders/g1"), { ...base, payment: "GCash" });
  await setDoc(doc(db, "orders/c1"), { ...base, payment: "Cash" });
  await setDoc(doc(db, "orders/x1"), { ...base, payment: "GCash", status: "cancelled" });
});
const cust = as("cust"), send = (id, over = {}, who = cust) => updateDoc(doc(who, "orders", id),
  { gcashRef: "1234567890123", gcashSender: "Juan 0917", gcashSentAt: serverTimestamp(), ...over });

await t("customer sends their GCash reference", () => assertSucceeds(send("g1")));
await t("customer fixes a typo before it's confirmed", () => assertSucceeds(send("g1", { gcashRef: "1234567890124" })));
await t("reference with symbols refused", () => assertFails(send("g1", { gcashRef: "1234-5678" })));
await t("reference too short refused", () => assertFails(send("g1", { gcashRef: "123" })));
await t("customer can't mark their own payment confirmed", () => assertFails(send("g1", { paymentConfirmed: true })));
await t("customer can't change the total while sending", () => assertFails(send("g1", { total: 1 })));
await t("reference on a cash order refused", () => assertFails(send("c1")));
await t("reference on a cancelled order refused", () => assertFails(send("x1")));
await t("another customer can't send a reference", () => assertFails(send("g1", {}, as("stranger"))));
await t("seller confirms the payment", () => assertSucceeds(updateDoc(doc(as("s1", "password"), "orders/g1"), { paymentConfirmed: true, paymentConfirmedAt: serverTimestamp() })));
await t("customer can't change the reference after confirmation", () => assertFails(send("g1", { gcashRef: "9999999999999" })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
