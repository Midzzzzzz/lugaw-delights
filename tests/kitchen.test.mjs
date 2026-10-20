// Kitchen staff: their own sign-up and approval; they see orders and only mark food ready.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, query, where, serverTimestamp, Timestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const order = (mode, status = "preparing") => ({ code: "LD-K", customerUid: "cust", mode, status, items: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 1 }],
  subtotal: 39, deliveryFee: 0, total: 39, payment: "Cash", riderUid: null, createdAt: Timestamp.now() });

await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "kitchen/k1"), { name: "Cook", phone: "09170000011", email: "k1@x.com", status: "approved" });
  await setDoc(doc(db, "kitchen/k2"), { name: "Paused Cook", phone: "09170000012", email: "k2@x.com", status: "suspended" });
  await setDoc(doc(db, "orders/dine"), order("Dine-in"));
  await setDoc(doc(db, "orders/pick"), order("Pickup"));
  await setDoc(doc(db, "orders/del"), { ...order("Delivery"), riderUid: "r1" });
  await setDoc(doc(db, "orders/new"), order("Pickup", "new"));
  await setDoc(doc(db, "contacts/pick"), { name: "Juan", phone: "09170001111", customerUid: "cust" });
});
const k1 = as("k1"), k2 = as("k2"), owner = as("owner"), newbie = as("newbie");
const done = (st) => ({ status: st, [st + "At"]: serverTimestamp() });

console.log("Signing up");
await t("new kitchen staff applies (pending)", () => assertSucceeds(setDoc(doc(newbie, "kitchen/newbie"), { name: "New Cook", phone: "09170000019", email: "n@x.com", status: "pending", createdAt: serverTimestamp() })));
await t("can't apply as already approved", () => assertFails(setDoc(doc(as("p2"), "kitchen/p2"), { name: "P", phone: "09170000018", email: "p@x.com", status: "approved", createdAt: serverTimestamp() })));
await t("anonymous customer can't apply", () => assertFails(setDoc(doc(as("anon", "anonymous"), "kitchen/anon"), { name: "A", phone: "09170000017", email: "", status: "pending", createdAt: serverTimestamp() })));
await t("kitchen staff can't approve themselves", () => assertFails(updateDoc(doc(newbie, "kitchen/newbie"), { status: "approved" })));
await t("pending kitchen staff can't read orders", () => assertFails(getDoc(doc(newbie, "orders/dine"))));
await t("kitchen staff can't list other staff", () => assertFails(getDocs(collection(k1, "kitchen"))));
await t("owner lists kitchen staff", () => assertSucceeds(getDocs(collection(owner, "kitchen"))));
await t("owner approves kitchen staff", () => assertSucceeds(updateDoc(doc(owner, "kitchen/newbie"), { status: "approved" })));

console.log("In the kitchen");
await t("kitchen reads orders being cooked", () => assertSucceeds(getDocs(query(collection(k1, "orders"), where("status", "==", "preparing")))));
await t("kitchen can't read customer contacts", () => assertFails(getDoc(doc(k1, "contacts/pick"))));
await t("kitchen can't open or close the store", () => assertFails(setDoc(doc(k1, "settings/store"), { open: false })));
await t("kitchen can't record a dine-in order", () => assertFails(setDoc(doc(k1, "orders/x1"), { ...order("Dine-in"), customerUid: "k1", sellerUid: "k1", sellerName: "Cook", table: "", notes: "", createdAt: serverTimestamp() })));
await t("kitchen can't mark a dine-in order paid", () => assertFails(updateDoc(doc(k1, "orders/dine"), { cashGiven: 100 })));
await t("kitchen can't change items or prices", () => assertFails(updateDoc(doc(k1, "orders/dine"), { total: 1, subtotal: 1 })));
await t("kitchen can't cancel an order", () => assertFails(updateDoc(doc(k1, "orders/dine"), { status: "cancelled", cancelledBy: "shop" })));
await t("kitchen can't start cooking a new order (the cashier accepts it)", () => assertFails(updateDoc(doc(k1, "orders/new"), done("preparing"))));
await t("kitchen can't skip a dine-in order to the wrong status", () => assertFails(updateDoc(doc(k1, "orders/dine"), done("ready_pickup"))));
await t("suspended kitchen staff can't mark food ready", () => assertFails(updateDoc(doc(k2, "orders/dine"), done("completed"))));
await t("kitchen marks a dine-in order served", () => assertSucceeds(updateDoc(doc(k1, "orders/dine"), done("completed"))));
await t("kitchen marks a pickup order ready", () => assertSucceeds(updateDoc(doc(k1, "orders/pick"), done("ready_pickup"))));
await t("kitchen marks a delivery order's food ready", () => assertSucceeds(updateDoc(doc(k1, "orders/del"), done("ready"))));
await t("kitchen can't move an order that isn't cooking", () => assertFails(updateDoc(doc(k1, "orders/pick"), done("completed"))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
