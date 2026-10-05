// A dine-in customer orders more: sellers add items to an unpaid dine-in order.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const seed = f => env.withSecurityRulesDisabled(c => f(c.firestore()));

const two = [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 2 }];
const coke = { id: "B02", name: "Coke", price: 25, qty: 1, round: 2 };
const dine = over => ({ code: "LD-A", customerUid: "s1", sellerUid: "s1", sellerName: "S", mode: "Dine-in", table: "3", notes: "", payment: "Cash",
  items: two, subtotal: 78, deliveryFee: 0, total: 78, status: "completed", riderUid: null, ...over });
await seed(async db => {
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "orders/a1"), dine());
  await setDoc(doc(db, "orders/a2"), dine({ cashGiven: 100 }));
  await setDoc(doc(db, "orders/a3"), dine({ status: "cancelled" }));
  await setDoc(doc(db, "orders/a4"), { code: "LD-D", customerUid: "c", mode: "Delivery", items: two, subtotal: 78, deliveryFee: 40, total: 118, status: "preparing" });
});
const s1 = as("s1");
const add = (who, id, over = {}) => updateDoc(doc(who, "orders", id),
  { items: [...two, coke], subtotal: 103, total: 103, status: "preparing", addedAt: serverTimestamp(), ...over });

await t("seller adds a Coke to a served dine-in order", () => assertSucceeds(add(s1, "a1")));
await t("adding can't lower the total", () => assertFails(add(s1, "a1", { items: [...two, coke, { ...coke, round: 3 }], subtotal: 50, total: 50 })));
await t("adding without new lines refused", () => assertFails(add(s1, "a1", { items: [...two, coke], subtotal: 200, total: 200 })));
await t("total must equal the new subtotal", () => assertFails(add(s1, "a1", { items: [...two, coke, { ...coke, round: 3 }], subtotal: 128, total: 999 })));
await t("order must go back to the kitchen", () => assertFails(add(s1, "a1", { items: [...two, coke, { ...coke, round: 3 }], subtotal: 128, total: 128, status: "completed" })));
await t("can't add to an order that's already paid", () => assertFails(add(s1, "a2")));
await t("can't add to a cancelled order", () => assertFails(add(s1, "a3")));
await t("can't add items to a delivery order", () => assertFails(add(s1, "a4")));
await t("customer can't add items", () => assertFails(add(as("cust", "anonymous"), "a1", { items: [...two, coke, { ...coke, round: 3 }], subtotal: 128, total: 128 })));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
