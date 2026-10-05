import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, writeBatch, query, where, orderBy, limit, runTransaction, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 }
});
await env.clearFirestore();
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "settings/delivery"), { fees: { "lb-anos": 40 } }));

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log("  ok  ", name); }
  catch (e) { fail++; console.log("  FAIL", name, "\n       ", e.message.split("\n")[0]); }
}
const seed = fn => env.withSecurityRulesDisabled(c => fn(c.firestore()));
const as = (uid, provider = "anonymous") => env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore();

await seed(async db => {
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "riders/rider1"), { name: "Rider One", phone: "09171234567", payMethod: "GCash", payName: "Rider", payNumber: "09171234567", payBank: "", status: "approved", online: true });
  await setDoc(doc(db, "agreements/rider1"), { riderUid: "rider1", version: "v1" });
  await setDoc(doc(db, "agreements/rider2"), { riderUid: "rider2", version: "v1" });
  await setDoc(doc(db, "riders/rider2"), { name: "Rider Two", phone: "09179999999", payMethod: "GCash", payName: "Rider", payNumber: "09171234567", payBank: "", status: "approved", online: true });
  await setDoc(doc(db, "riders/pending1"), { name: "P", phone: "09170000000", status: "pending", online: false });
});

const goodItems = [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 2 }];
function order(uid, over = {}) {
  return { code: "LD-X", customerUid: uid, mode: "Delivery", address: "123 St", notes: "", payment: "Cash",
    items: goodItems, zone: "lb-anos", zoneName: "Anos, Los Baños", subtotal: 78, deliveryFee: 40, total: 118, status: "new", riderUid: null, createdAt: serverTimestamp(), hasPin: true, ...over };
}
async function place(db, uid, id, over = {}, { contact = true, throttle = true } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "orders", id), order(uid, over));
  if (contact) b.set(doc(db, "contacts", id), { name: "Juan", phone: "09170001111", customerUid: uid, createdAt: serverTimestamp() });
  if (throttle) b.set(doc(db, "customers", uid), { lastOrderAt: serverTimestamp(), lastOrderId: id });
  b.set(doc(db, "pins", id), { pin: "1234", customerUid: uid });
  return b.commit();
}

console.log("Placing orders");
const alice = as("alice");
await t("customer places a valid order", () => assertSucceeds(place(alice, "alice", "o1")));
await t("second order within a minute is refused", () => assertFails(place(alice, "alice", "o1b")));
await t("order without contact doc is refused", () => assertFails(place(as("bob"), "bob", "o2", {}, { contact: false })));
await t("order without rate-limit record is refused", () => assertFails(place(as("bob"), "bob", "o2", {}, { throttle: false })));
await t("script in qty is refused", () => assertFails(place(as("x1"), "x1", "bad1", { items: [{ id: "L01", name: "a", price: 39, qty: "<img src=x onerror=alert(1)>" }] })));
await t("fractional qty is refused", () => assertFails(place(as("x2"), "x2", "bad2", { items: [{ id: "L01", name: "a", price: 39, qty: 0.5 }] })));
// By design the rules only check each line's quantity (checking every field of 20 lines would pass
// Firestore's 1000-step limit). Extra fields are harmless: the pages show menu names, escape every value,
// and flag orders whose prices don't match the menu.
await t("extra field inside an item is accepted (by design)", () => assertSucceeds(place(as("x3"), "x3", "bad3", { items: [{ ...goodItems[0], evil: "<b>" }] })));
await t("item beyond line 1 is checked too", () => assertFails(place(as("x4"), "x4", "bad4", { items: [goodItems[0], goodItems[0], { id: "L01", name: "a", price: 39, qty: "9" }] })));
await t("21 lines is refused", () => assertFails(place(as("x5"), "x5", "bad5", { items: Array(21).fill(goodItems[0]), subtotal: 1638, total: 1678 })));
await t("total that isn't subtotal + fee is refused", () => assertFails(place(as("x6"), "x6", "bad6", { total: 1 })));
await t("pickup order with a delivery fee is refused", () => assertFails(place(as("x7"), "x7", "bad7", { mode: "Pickup" })));
await t("customer name/phone on the order itself is refused", () => assertFails(place(as("x8"), "x8", "bad8", { name: "Juan" })));
await t("two orders in one batch are refused", () => {
  const db = as("x9"), b = writeBatch(db);
  for (const id of ["m1", "m2"]) {
    b.set(doc(db, "orders", id), order("x9"));
    b.set(doc(db, "contacts", id), { name: "J", phone: "09170001111", customerUid: "x9", createdAt: serverTimestamp() });
  }
  b.set(doc(db, "customers/x9"), { lastOrderAt: serverTimestamp(), lastOrderId: "m2" });
  return assertFails(b.commit());
});
await seed(db => setDoc(doc(db, "settings/store"), { open: false }));
await t("ordering while store is closed is refused", () => assertFails(place(as("carol"), "carol", "o3")));
await seed(db => setDoc(doc(db, "settings/store"), { open: true }));
await t("ordering after store reopens works", () => assertSucceeds(place(as("carol"), "carol", "o3")));

console.log("Reading");
await t("customer reads own order", () => assertSucceeds(getDoc(doc(alice, "orders/o1"))));
await t("customer can't read someone else's order", () => assertFails(getDoc(doc(as("carol"), "orders/o1"))));
await t("customer can't read someone else's contact", () => assertFails(getDoc(doc(as("carol"), "contacts/o1"))));
await t("customer can't cancel after the shop accepts", async () => {
  await seed(db => updateDoc(doc(db, "orders/o3"), { status: "preparing" }));
  return assertFails(updateDoc(doc(as("carol"), "orders/o3"), { status: "cancelled", cancelledBy: "customer" }));
});
// o1 is a new delivery order: it looks for a rider before the store cooks
const r1 = as("rider1", "password"), r2 = as("rider2", "password");
await t("pending rider can't read waiting orders", () => assertFails(getDocs(query(collection(as("pending1", "password"), "orders"), where("mode", "==", "Delivery"), where("riderUid", "==", null), where("status", "in", ["new", "preparing", "ready"])))));
await t("approved rider lists orders needing a rider", () => assertSucceeds(getDocs(query(collection(r1, "orders"), where("mode", "==", "Delivery"), where("riderUid", "==", null), where("status", "in", ["new", "preparing", "ready"])))));
await t("rider can read the customer contact to call before accepting", () => assertSucceeds(getDoc(doc(r1, "contacts/o1"))));
await t("pending rider can't read the customer contact", () => assertFails(getDoc(doc(as("pending1", "password"), "contacts/o1"))));

console.log("Delivering");
await t("rider accepts (transaction)", () => assertSucceeds(runTransaction(r1, async tx => {
  const ref = doc(r1, "orders/o1"); await tx.get(ref);
  tx.update(ref, { status: "assigned", riderUid: "rider1", riderName: "Rider One", riderPhone: "09171234567", assignedAt: serverTimestamp() });
})));
await t("second rider can't take it", () => assertFails(updateDoc(doc(r2, "orders/o1"),
  { status: "assigned", riderUid: "rider2", riderName: "Rider Two", riderPhone: "09179999999", assignedAt: serverTimestamp() })));
await t("rider reads contact after accepting", () => assertSucceeds(getDoc(doc(r1, "contacts/o1"))));
await t("other rider still can't read contact", () => assertFails(getDoc(doc(r2, "contacts/o1"))));
await t("rider's active-orders query", () => assertSucceeds(getDocs(query(collection(r1, "orders"), where("riderUid", "==", "rider1"), where("status", "==", "assigned")))));
await t("store cooks once the rider has accepted", () => assertSucceeds(updateDoc(doc(as("owner", "password"), "orders/o1"), { status: "preparing" })));
await t("store marks the food ready", () => assertSucceeds(updateDoc(doc(as("owner", "password"), "orders/o1"), { status: "ready" })));
await t("rider can't pick up a cash order without paying the shop", () => assertFails(updateDoc(doc(r1, "orders/o1"), { status: "picked_up", pickedUpAt: serverTimestamp() })));
await t("seller confirms the rider paid for the food", () => assertSucceeds(updateDoc(doc(as("owner", "password"), "orders/o1"), { status: "picked_up", pickedUpAt: serverTimestamp(), riderPaid: true, riderPaidAt: serverTimestamp(), cashReceived: true })));
await t("rider who paid can't leave the order unsettled", () => assertFails(updateDoc(doc(r1, "orders/o1"),
  { status: "delivered", deliveredAt: serverTimestamp(), deliveredDate: "2026-09-30", settled: false, pinEntered: "1234" })));
await t("rider marks delivered (nothing left to settle)", () => assertSucceeds(updateDoc(doc(r1, "orders/o1"),
  { status: "delivered", deliveredAt: serverTimestamp(), deliveredDate: "2026-09-30", settled: true, pinEntered: "1234" })));
await t("rider's today query", () => assertSucceeds(getDocs(query(collection(r1, "orders"), where("riderUid", "==", "rider1"), where("deliveredDate", "==", "2026-09-30")))));
await t("rider's unsettled query", () => assertSucceeds(getDocs(query(collection(r1, "orders"), where("riderUid", "==", "rider1"), where("settled", "==", false)))));
await t("rider can't settle their own cash", () => assertFails(updateDoc(doc(r1, "orders/o1"), { settled: true, cashReceived: true })));

console.log("Owner");
const owner = as("owner", "password");
await t("owner's latest-orders query", () => assertSucceeds(getDocs(query(collection(owner, "orders"), orderBy("createdAt", "desc"), limit(300)))));
await t("owner's active query", () => assertSucceeds(getDocs(query(collection(owner, "orders"), where("status", "in", ["new", "preparing", "ready", "ready_pickup", "assigned", "picked_up"])))));
await t("owner's unsettled query", () => assertSucceeds(getDocs(query(collection(owner, "orders"), where("settled", "==", false)))));
await t("owner's contacts query", () => assertSucceeds(getDocs(query(collection(owner, "contacts"), orderBy("createdAt", "desc"), limit(300)))));
await t("owner settles cash", () => assertSucceeds(updateDoc(doc(owner, "orders/o1"), { cashReceived: true, settled: true, settledAt: serverTimestamp() })));
await t("owner sends an assigned order back to riders", async () => {
  await seed(db => updateDoc(doc(db, "orders/o3"), { status: "assigned", riderUid: "rider2", riderName: "Rider Two", riderPhone: "09179999999" }));
  await assertSucceeds(updateDoc(doc(owner, "orders/o3"), { status: "ready", riderUid: null, riderName: null, riderPhone: null, assignedAt: null }));
});
await t("owner closes the store", () => assertSucceeds(setDoc(doc(owner, "settings/store"), { open: false }, { merge: true })));
await t("non-owner can't close the store", () => assertFails(setDoc(doc(r1, "settings/store"), { open: true }, { merge: true })));
await t("rider can't make themselves an owner", () => assertFails(setDoc(doc(r1, "admins/rider1"), { name: "x" })));

console.log("GCash pickup");
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/gp"), { code: "LD-GP", customerUid: "c", mode: "Delivery", payment: "GCash", status: "assigned", riderUid: "rider1", total: 118, subtotal: 78, deliveryFee: 40 }));
await t("rider picks up a GCash order themselves", () => assertSucceeds(updateDoc(doc(r1, "orders/gp"), { status: "picked_up", pickedUpAt: serverTimestamp() })));
await t("GCash delivery can't be marked settled (shop still owes the fee)", () => assertFails(updateDoc(doc(r1, "orders/gp"), { status: "delivered", deliveredAt: serverTimestamp(), deliveredDate: "2026-10-01", settled: true, pinEntered: "" })));
await t("GCash delivery left unsettled", () => assertSucceeds(updateDoc(doc(r1, "orders/gp"), { status: "delivered", deliveredAt: serverTimestamp(), deliveredDate: "2026-10-01", settled: false, pinEntered: "" })));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
