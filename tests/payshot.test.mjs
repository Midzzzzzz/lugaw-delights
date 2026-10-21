// Orders paid by QR: the customer sends a screenshot of the payment instead of a reference number.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const base = { customerUid: "cust", mode: "Delivery", status: "assigned", riderName: "R", riderPhone: "09170000099", items: [], subtotal: 189, deliveryFee: 40, total: 229, riderUid: "rX" };
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "orders/q1"), { ...base, code: "LD-Q1", payment: "GCash" });
  await setDoc(doc(db, "orders/q2"), { ...base, code: "LD-Q2", payment: "Cash" });
  await setDoc(doc(db, "orders/q3"), { ...base, code: "LD-Q3", payment: "GCash", paymentConfirmed: true });
});
const pic = "data:image/jpeg;base64," + "A".repeat(600000); // a big screenshot, still under the limit
const cust = as("cust", "anonymous"), other = as("other", "anonymous");
const send = (db, id, photo = pic, uid = "cust") => { const b = writeBatch(db);
  b.set(doc(db, "payshots", id), { customerUid: uid, photo, sentAt: serverTimestamp() });
  b.update(doc(db, "orders", id), { payShotAt: serverTimestamp() }); return b.commit(); };
const accept = id => updateDoc(doc(as("s1"), "orders", id), { status: "preparing", preparingAt: serverTimestamp(), sellerUid: "s1", sellerName: "S" });

console.log("Payment screenshots");
await t("can't mark it paid without a screenshot", () => assertFails(updateDoc(doc(cust, "orders/q1"), { payShotAt: serverTimestamp() })));
await t("seller can't cook it before the screenshot", () => assertFails(accept("q1")));
await t("another customer can't send a screenshot for this order", () => assertFails(send(other, "q1", pic, "other")));
await t("not a JPEG picture refused", () => assertFails(send(cust, "q1", "data:image/png;base64,AAAA")));
await t("too big a picture refused", () => assertFails(send(cust, "q1", "data:image/jpeg;base64," + "A".repeat(800000))));
await t("customer sends the screenshot", () => assertSucceeds(send(cust, "q1")));
await t("customer can send a different one", () => assertSucceeds(send(cust, "q1")));
await t("customer sees their own screenshot", () => assertSucceeds(getDoc(doc(cust, "payshots/q1"))));
await t("another customer can't see it", () => assertFails(getDoc(doc(other, "payshots/q1"))));
await t("seller sees it", () => assertSucceeds(getDoc(doc(as("s1"), "payshots/q1"))));
await t("owner sees it", () => assertSucceeds(getDoc(doc(as("owner"), "payshots/q1"))));
await t("seller cooks it once the screenshot is in", () => assertSucceeds(accept("q1")));
await t("no screenshot on a cash order", () => assertFails(send(cust, "q2")));
await t("no new screenshot once the shop confirmed the payment", () => assertFails(send(cust, "q3")));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
