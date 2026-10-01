import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, query, where, orderBy, serverTimestamp, Timestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();

await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "sellers/s1"), { name: "Seller One", phone: "09170000001", email: "s1@x.com", status: "approved" });
  await setDoc(doc(db, "sellers/s2"), { name: "Seller Two", phone: "09170000002", email: "s2@x.com", status: "approved" });
  await setDoc(doc(db, "riders/r1"), { name: "Rider", phone: "09171234567", status: "pending", online: false });
  await setDoc(doc(db, "orders/o1"), { code: "LD-1", customerUid: "cust", mode: "Delivery", status: "new", items: [], subtotal: 78, deliveryFee: 40, total: 118, payment: "Cash", riderUid: null, createdAt: Timestamp.now() });
  await setDoc(doc(db, "contacts/o1"), { name: "Juan", phone: "09170001111", customerUid: "cust" });
});
const s1 = as("s1"), s2 = as("s2"), owner = as("owner"), newbie = as("newbie"), pend = as("pend");

console.log("Signing up");
await t("new seller applies (pending)", () => assertSucceeds(setDoc(doc(newbie, "sellers/newbie"), { name: "New", phone: "09170000009", email: "n@x.com", status: "pending", createdAt: serverTimestamp() })));
await t("seller can't apply as already approved", () => assertFails(setDoc(doc(pend, "sellers/pend"), { name: "P", phone: "09170000008", email: "p@x.com", status: "approved", createdAt: serverTimestamp() })));
await t("anonymous customer can't apply as seller", () => assertFails(setDoc(doc(as("anon", "anonymous"), "sellers/anon"), { name: "A", phone: "09170000007", email: "", status: "pending", createdAt: serverTimestamp() })));
await t("seller can't approve themselves", () => assertFails(updateDoc(doc(newbie, "sellers/newbie"), { status: "approved" })));
await t("pending seller can't read orders", () => assertFails(getDoc(doc(newbie, "orders/o1"))));
await t("seller can't list other sellers", () => assertFails(getDocs(collection(s1, "sellers"))));
await t("owner lists sellers", () => assertSucceeds(getDocs(collection(owner, "sellers"))));
await t("owner approves a seller", () => assertSucceeds(updateDoc(doc(owner, "sellers/newbie"), { status: "approved" })));

console.log("Working the counter");
await t("seller reads orders and contacts", async () => { await assertSucceeds(getDoc(doc(s1, "orders/o1"))); await assertSucceeds(getDoc(doc(s1, "contacts/o1"))); });
await t("seller lists riders", () => assertSucceeds(getDocs(collection(s1, "riders"))));
await t("seller can't approve a rider", () => assertFails(updateDoc(doc(s1, "riders/r1"), { status: "approved" })));
await t("seller can't credit a sale to another seller", () => assertFails(updateDoc(doc(s1, "orders/o1"), { status: "preparing", sellerUid: "s2", sellerName: "Seller Two" })));
await t("seller accepts an order, credited to themselves", () => assertSucceeds(updateDoc(doc(s1, "orders/o1"), { status: "preparing", preparingAt: serverTimestamp(), sellerUid: "s1", sellerName: "Seller One" })));
await t("another seller can't take the credit", () => assertFails(updateDoc(doc(s2, "orders/o1"), { sellerUid: "s2", sellerName: "Seller Two" })));
await t("seller can't change the total", () => assertFails(updateDoc(doc(s1, "orders/o1"), { total: 1 })));
await t("seller can't change the items", () => assertFails(updateDoc(doc(s1, "orders/o1"), { items: [{ id: "L10", name: "x", price: 189, qty: 9 }] })));
await t("seller moves order along", () => assertSucceeds(updateDoc(doc(s1, "orders/o1"), { status: "ready", readyAt: serverTimestamp() })));
await t("seller records cash received", () => assertSucceeds(updateDoc(doc(s1, "orders/o1"), { cashGiven: 200 })));
await t("seller records a dine-in order", () => assertSucceeds(setDoc(doc(s1, "orders/d1"), { code: "LD-D", customerUid: "s1", sellerUid: "s1", sellerName: "Seller One", mode: "Dine-in", table: "3", notes: "", payment: "Cash", items: [{ id: "L01", name: "x", price: 39, qty: 2 }], subtotal: 78, deliveryFee: 0, total: 78, status: "preparing", riderUid: null, createdAt: serverTimestamp() })));
await t("seller switches the store", () => assertSucceeds(setDoc(doc(s1, "settings/store"), { open: true }, { merge: true })));
await t("seller can't make themselves owner", () => assertFails(setDoc(doc(s1, "admins/s1"), { name: "x" })));

await t("seller cancels with a reason", () => assertSucceeds(updateDoc(doc(s1, "orders/o1"), { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: "shop", cancelReason: "Sold out of an item you ordered" })));
await t("cancel reason over 150 characters refused", () => assertFails(updateDoc(doc(s1, "orders/o1"), { cancelReason: "x".repeat(151) })));
await t("customer reads the cancel reason", () => assertSucceeds(getDoc(doc(as("cust", "anonymous"), "orders/o1"))));
console.log("Suspended");
await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), "sellers/s2"), { status: "suspended" }));
await t("suspended seller can't read orders", () => assertFails(getDoc(doc(s2, "orders/o1"))));
await t("suspended seller can't record dine-in", () => assertFails(setDoc(doc(s2, "orders/d2"), { code: "LD-E", customerUid: "s2", sellerUid: "s2", sellerName: "Seller Two", mode: "Dine-in", table: "", notes: "", payment: "Cash", items: [{ id: "L01", name: "x", price: 39, qty: 1 }], subtotal: 39, deliveryFee: 0, total: 39, status: "preparing", riderUid: null, createdAt: serverTimestamp() })));

console.log("Owner reports");
await t("owner's date-range query", () => assertSucceeds(getDocs(query(collection(owner, "orders"), where("createdAt", ">=", Timestamp.fromDate(new Date(2020, 0, 1))), where("createdAt", "<", Timestamp.fromDate(new Date(2100, 0, 1))), orderBy("createdAt", "desc")))));
await t("seller's date-range query also works", () => assertSucceeds(getDocs(query(collection(s1, "orders"), where("createdAt", ">=", Timestamp.fromDate(new Date(2020, 0, 1))), orderBy("createdAt", "desc")))));
await t("customer can't run the range query", () => assertFails(getDocs(query(collection(as("cust", "anonymous"), "orders"), where("createdAt", ">=", Timestamp.fromDate(new Date(2020, 0, 1))), orderBy("createdAt", "desc")))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
