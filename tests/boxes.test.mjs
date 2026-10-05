// Take-out box fee: delivery orders are boxed; dine-in items can be packed in a box or plastic.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, writeBatch, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "settings/delivery"), { fees: { "lb-anos": 40 } });
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
});
const lugaw2 = [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 2 }];
let n = 0;
function place(mode, { boxFee, total }) {
  const uid = "b" + (++n), db = as(uid, "anonymous"), b = writeBatch(db), id = "o" + n, fee = mode === "Delivery" ? 40 : 0;
  b.set(doc(db, "orders", id), { code: "LD-" + n, customerUid: uid, mode, address: mode === "Delivery" ? "St" : "", notes: "", payment: "Cash",
    items: lugaw2, subtotal: 78, deliveryFee: fee, ...(boxFee === undefined ? {} : { boxFee }), total,
    ...(mode === "Delivery" ? { zone: "lb-anos", zoneName: "Anos", hasPin: true } : {}), status: "new", riderUid: null, createdAt: serverTimestamp() });
  b.set(doc(db, "contacts", id), { name: "J", phone: "09170001111", customerUid: uid, createdAt: serverTimestamp() });
  b.set(doc(db, "customers", uid), { lastOrderAt: serverTimestamp(), lastOrderId: id });
  if (mode === "Delivery") b.set(doc(db, "pins", id), { pin: "1234", customerUid: uid });
  return b.commit();
}
console.log("Online orders");
await t("delivery with 2 boxes: 78 + 40 + 20 = 138", () => assertSucceeds(place("Delivery", { boxFee: 20, total: 138 })));
await t("total that leaves out the boxes refused", () => assertFails(place("Delivery", { boxFee: 20, total: 118 })));
await t("negative box fee refused", () => assertFails(place("Delivery", { boxFee: -20, total: 98 })));
await t("older app without a box fee still accepted (seller sees a price warning)", () => assertSucceeds(place("Delivery", { total: 118 })));
await t("pickup has no box fee", () => assertSucceeds(place("Pickup", { boxFee: 0, total: 78 })));
await t("pickup with a box fee refused", () => assertFails(place("Pickup", { boxFee: 20, total: 98 })));

console.log("Dine-in");
const s1 = as("s1");
const dine = (id, over) => setDoc(doc(s1, "orders", id), { code: "LD-D", customerUid: "s1", sellerUid: "s1", sellerName: "S", mode: "Dine-in", table: "3", notes: "",
  payment: "Cash", items: lugaw2, subtotal: 78, deliveryFee: 0, status: "preparing", riderUid: null, createdAt: serverTimestamp(), ...over });
await t("dine-in eaten here: no boxes", () => assertSucceeds(dine("d1", { boxFee: 0, total: 78 })));
await t("dine-in take-out in boxes: 78 + 20", () => assertSucceeds(dine("d2", { items: lugaw2.map(i => ({ ...i, pack: "box" })), boxFee: 20, total: 98 })));
await t("dine-in total must include the boxes", () => assertFails(dine("d3", { boxFee: 20, total: 78 })));
const coke = { id: "B02", name: "Coke", price: 25, qty: 1, round: 2 };
const take2 = { id: "L01", name: "Plain Lugaw", price: 39, qty: 1, round: 2, pack: "box" };
await t("add a take-out bowl in a box to a dine-in order", () => assertSucceeds(updateDoc(doc(s1, "orders/d1"),
  { items: [...lugaw2, take2], subtotal: 117, boxFee: 10, total: 127, status: "preparing", addedAt: serverTimestamp() })));
await t("adding can't remove boxes already charged", () => assertFails(updateDoc(doc(s1, "orders/d1"),
  { items: [...lugaw2, take2, coke], subtotal: 142, boxFee: 0, total: 142, status: "preparing", addedAt: serverTimestamp() })));
await t("add a drink with no box", () => assertSucceeds(updateDoc(doc(s1, "orders/d1"),
  { items: [...lugaw2, take2, coke], subtotal: 142, boxFee: 10, total: 152, status: "preparing", addedAt: serverTimestamp() })));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
