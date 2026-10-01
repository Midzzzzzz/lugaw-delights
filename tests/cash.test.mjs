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
console.log("Default limit (500, no settings saved)");
await t("cash order of 418 allowed", () => assertSucceeds(place("Cash", 2)));
await t("cash order of 607 refused", () => assertFails(place("Cash", 3)));
await t("GCash order of 607 allowed", () => assertSucceeds(place("GCash", 3)));
console.log("Owner settings");
await t("seller can't change the limit", () => assertFails(setDoc(doc(as("s1"), "settings/store"), { cashMax: 0 }, { merge: true })));
await t("seller opens and closes the store", () => assertSucceeds(setDoc(doc(as("s1"), "settings/store"), { open: true }, { merge: true })));
await t("seller still can't change the limit once the doc exists", () => assertFails(setDoc(doc(as("s1"), "settings/store"), { cashMax: 99999 }, { merge: true })));
await t("owner can't set a negative limit", () => assertFails(setDoc(doc(as("owner"), "settings/store"), { cashMax: -1 }, { merge: true })));
await t("owner sets limit to 1000", () => assertSucceeds(setDoc(doc(as("owner"), "settings/store"), { cashMax: 1000 }, { merge: true })));
await t("cash order of 607 now allowed", () => assertSucceeds(place("Cash", 3)));
await t("cash order of 1174 refused", () => assertFails(place("Cash", 6)));
await t("owner turns the limit off (0)", () => assertSucceeds(setDoc(doc(as("owner"), "settings/store"), { cashMax: 0 }, { merge: true })));
await t("cash order of 1174 now allowed", () => assertSucceeds(place("Cash", 6)));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
