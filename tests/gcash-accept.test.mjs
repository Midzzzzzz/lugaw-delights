// An online GCash order can't be accepted (cooked) until the customer sends their GCash reference number.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const base = { customerUid: "cust", mode: "Delivery", status: "assigned", riderName: "R", riderPhone: "09170000099", items: [], subtotal: 189, deliveryFee: 40, total: 229, riderUid: "rX" };
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "orders/g1"), { ...base, code: "LD-G1", payment: "GCash" });
  await setDoc(doc(db, "orders/g2"), { ...base, code: "LD-G2", payment: "GCash" });
  await setDoc(doc(db, "orders/c1"), { ...base, code: "LD-C1", payment: "Cash" });
});
const s1 = as("s1"), accept = id => updateDoc(doc(s1, "orders", id), { status: "preparing", preparingAt: serverTimestamp(), sellerUid: "s1", sellerName: "S" });

await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/n1"), { ...base, code: "LD-N1", payment: "Cash", status: "new", riderUid: null }));
await t("seller can't cook a delivery order that has no rider yet", () => assertFails(accept("n1")));
await t("seller can't accept a GCash order before the customer pays", () => assertFails(accept("g1")));
await t("seller can still cancel an unpaid GCash order", () => assertSucceeds(updateDoc(doc(s1, "orders/g2"), { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: "shop", cancelReason: "Not paid" })));
await t("customer sends their reference number", () => assertSucceeds(updateDoc(doc(as("cust", "anonymous"), "orders/g1"), { gcashRef: "1234567890123", gcashSender: "Juan", gcashSentAt: serverTimestamp() })));
await t("seller accepts it once the reference is in", () => assertSucceeds(accept("g1")));
await t("cash orders can be accepted right away", () => assertSucceeds(accept("c1")));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
