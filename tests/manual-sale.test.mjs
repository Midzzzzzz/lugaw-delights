// The owner adds sales by hand for past dates, and puts photos on the menu.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "settings/store"), { open: false }); // works even when online ordering is closed
});
const owner = as("owner"), s1 = as("s1"), cust = as("cust", "anonymous");
const lastWeek = Timestamp.fromDate(new Date(Date.now() - 7 * 86400000));
const sale = (over = {}) => ({ code: "LD-M1", customerUid: "owner", sellerUid: "owner", sellerName: "Owner", mode: "Dine-in", table: "", notes: "", payment: "Cash",
  items: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 2 }], subtotal: 78, deliveryFee: 0, boxFee: 0, total: 78, status: "completed", riderUid: null,
  createdAt: lastWeek, manual: true, addedBy: "owner", addedAt: serverTimestamp(), cashGiven: 78, paidTotal: 78, ...over });

console.log("Adding past sales");
await t("owner adds a cash sale dated last week", () => assertSucceeds(setDoc(doc(owner, "orders/m1"), sale())));
await t("owner adds a GCash sale dated last week", () => assertSucceeds(setDoc(doc(owner, "orders/m2"), (({ cashGiven, ...r }) => r)(sale({ payment: "GCash", paid: true })))));
await t("a sale dated in the future refused", () => assertFails(setDoc(doc(owner, "orders/m3"), sale({ createdAt: Timestamp.fromDate(new Date(Date.now() + 86400000)) }))));
await t("a sale whose total doesn't add up refused", () => assertFails(setDoc(doc(owner, "orders/m4"), sale({ total: 10, cashGiven: 10, paidTotal: 10 }))));
await t("a sale not marked as added by hand refused", () => assertFails(setDoc(doc(owner, "orders/m5"), sale({ manual: false }))));
await t("a sale credited to someone else refused", () => assertFails(setDoc(doc(owner, "orders/m6"), sale({ sellerUid: "s1" }))));
await t("a past sale that's still being cooked refused", () => assertFails(setDoc(doc(owner, "orders/m7"), sale({ status: "preparing" }))));
await t("imported Loyverse delivery receipt with its delivery fee", () => assertSucceeds(setDoc(doc(owner, "orders/loyverse-5-0061"),
  sale({ mode: "Delivery", deliveryFee: 45, boxFee: 10, total: 133, cashGiven: 133, paidTotal: 133, source: "loyverse", receipt: "5-0061" }))));
await t("imported takeout receipt as pickup", () => assertSucceeds(setDoc(doc(owner, "orders/loyverse-4-0001"), sale({ mode: "Pickup", source: "loyverse", receipt: "4-0001" }))));
await t("a delivery fee on a dine-in sale refused", () => assertFails(setDoc(doc(owner, "orders/m10"), sale({ deliveryFee: 45, total: 123, cashGiven: 123, paidTotal: 123 }))));
await t("a delivery fee left out of the total refused", () => assertFails(setDoc(doc(owner, "orders/m11"), sale({ mode: "Delivery", deliveryFee: 45 }))));
await t("an unknown source refused", () => assertFails(setDoc(doc(owner, "orders/m12"), sale({ source: "other" }))));
await t("a seller can't add a past sale", () => assertFails(setDoc(doc(s1, "orders/m8"), sale({ customerUid: "s1", sellerUid: "s1", addedBy: "s1" }))));
await t("a customer can't add a past sale", () => assertFails(setDoc(doc(cust, "orders/m9"), sale({ customerUid: "cust", sellerUid: "cust", addedBy: "cust" }))));

console.log("Menu photos");
const photo = { photo: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==", updatedAt: serverTimestamp() };
await t("owner adds a photo to an item", () => assertSucceeds(setDoc(doc(owner, "menuPhotos/L01"), photo)));
await t("customers see menu photos", () => assertSucceeds(getDoc(doc(cust, "menuPhotos/L01"))));
await t("a seller can't change menu photos", () => assertFails(setDoc(doc(s1, "menuPhotos/L01"), photo)));
await t("something that isn't a photo refused", () => assertFails(setDoc(doc(owner, "menuPhotos/L02"), { photo: "hello", updatedAt: serverTimestamp() })));
await t("owner removes a photo", () => assertSucceeds(deleteDoc(doc(owner, "menuPhotos/L01"))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
