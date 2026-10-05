import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, writeBatch, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "settings/delivery"), { fees: { "lb-anos": 40 } }));
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
});
let n = 0;
// qty of Lugaw Delights (189 each) + 40 delivery fee
function place(payment, qty) {
  const uid = "c" + (++n), db = as(uid, "anonymous"), b = writeBatch(db), id = "o" + n, sub = 189 * qty;
  b.set(doc(db, "orders", id), { code: "LD-" + n, customerUid: uid, mode: "Delivery", address: "St", notes: "", payment,
    items: [{ id: "L10", name: "Lugaw Delights", price: 189, qty }], zone: "lb-anos", zoneName: "Anos, Los Baños", subtotal: sub, deliveryFee: 40, total: sub + 40,
    status: "new", riderUid: null, createdAt: serverTimestamp(), hasPin: true });
  b.set(doc(db, "contacts", id), { name: "J", phone: "09170001111", customerUid: uid, createdAt: serverTimestamp() });
  b.set(doc(db, "customers", uid), { lastOrderAt: serverTimestamp(), lastOrderId: id });
  b.set(doc(db, "pins", id), { pin: "1234", customerUid: uid });
  return b.commit();
}
// Online orders (delivery and pickup) are cash only, with no amount limit.
console.log("Cash-only online orders");
await t("small cash order allowed", () => assertSucceeds(place("Cash", 1)));
await t("big cash order allowed (no cash limit)", () => assertSucceeds(place("Cash", 10)));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "settings/store"), { open: true, cashMax: 300 }));
await t("an old cash limit setting no longer blocks orders", () => assertSucceeds(place("Cash", 5)));
await t("online GCash order refused", () => assertFails(place("GCash", 1)));
await t("unknown payment method refused", () => assertFails(place("Card", 1)));
await t("seller still opens and closes the store", () => assertSucceeds(setDoc(doc(as("s1"), "settings/store"), { open: true }, { merge: true })));
await t("seller can't change other shop settings", () => assertFails(setDoc(doc(as("s1"), "settings/store"), { cashMax: 0 }, { merge: true })));
console.log(`
${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
