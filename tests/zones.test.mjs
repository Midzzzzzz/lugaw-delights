import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, writeBatch, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(async c => {
  await setDoc(doc(c.firestore(), "admins/owner"), { name: "Owner" });
  await setDoc(doc(c.firestore(), "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
});
let n = 0;
function place({ mode = "Delivery", zone = "lb-anos", fee = 40, withZone = true } = {}) {
  const uid = "z" + (++n), db = as(uid, "anonymous"), b = writeBatch(db), id = "o" + n, f = mode === "Delivery" ? fee : 0;
  b.set(doc(db, "orders", id), { code: "LD-" + n, customerUid: uid, mode, address: mode === "Delivery" ? "12 St, Brgy. X" : "", notes: "", payment: "Cash",
    items: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 2 }], subtotal: 78, deliveryFee: f, total: 78 + f,
    ...(mode === "Delivery" && withZone ? { zone, zoneName: "Somewhere, Laguna" } : {}),
    ...(mode === "Delivery" ? { hasPin: true } : {}), status: "new", riderUid: null, createdAt: serverTimestamp() });
  b.set(doc(db, "contacts", id), { name: "J", phone: "09170001111", customerUid: uid, createdAt: serverTimestamp() });
  b.set(doc(db, "customers", uid), { lastOrderAt: serverTimestamp(), lastOrderId: id });
  if (mode === "Delivery") b.set(doc(db, "pins", id), { pin: "1234", customerUid: uid });
  return b.commit();
}
console.log("Before the owner has saved any delivery areas");
await t("delivery refused", () => assertFails(place()));
await t("pickup still works", () => assertSucceeds(place({ mode: "Pickup" })));

console.log("Owner sets fees");
await t("seller can't change delivery fees", () => assertFails(setDoc(doc(as("s1"), "settings/delivery"), { fees: { "lb-anos": 0 } })));
await t("owner saves delivery fees", () => assertSucceeds(setDoc(doc(as("owner"), "settings/delivery"), { fees: { "lb-anos": 40, "lb-bagong-silang": 60, "bay-tranca": 70 } })));

console.log("Customers ordering");
await t("Anos with the ₱40 fee works", () => assertSucceeds(place()));
await t("Bagong Silang with the ₱60 fee works", () => assertSucceeds(place({ zone: "lb-bagong-silang", fee: 60 })));
await t("Tranca, Bay with the ₱70 fee works", () => assertSucceeds(place({ zone: "bay-tranca", fee: 70 })));
await t("Bagong Silang with a ₱40 fee refused", () => assertFails(place({ zone: "lb-bagong-silang", fee: 40 })));
await t("free delivery refused", () => assertFails(place({ fee: 0 })));
await t("Bicutan, Taguig refused", () => assertFails(place({ zone: "taguig-bicutan", fee: 40 })));
await t("barangay the owner unticked refused", () => assertFails(place({ zone: "lb-tadlac", fee: 40 })));
await t("delivery without a barangay refused", () => assertFails(place({ withZone: false })));
await t("pickup needs no barangay", () => assertSucceeds(place({ mode: "Pickup" })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
