// Inventory counts and the owner's menu: only the owner writes them; sellers read the count.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

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
  await setDoc(doc(db, "kitchen/k1"), { name: "K", phone: "09170000002", email: "", status: "approved" });
});
const owner = as("owner"), s1 = as("s1"), k1 = as("k1"), cust = as("cust", "anonymous");
const count = (over = {}) => ({ since: serverTimestamp(), createdAt: serverTimestamp(), closedAt: null, items: { L01: 50, B02: 24 }, by: "owner", ...over });

console.log("Inventory");
await t("owner starts a count with beginning stock", () => assertSucceeds(setDoc(doc(owner, "inventory/c1"), count())));
await t("count credited to someone else refused", () => assertFails(setDoc(doc(owner, "inventory/c2"), count({ by: "s1" }))));
await t("count that starts already closed refused", () => assertFails(setDoc(doc(owner, "inventory/c3"), count({ closedAt: serverTimestamp() }))));
await t("seller can't start a count", () => assertFails(setDoc(doc(s1, "inventory/c4"), count({ by: "s1" }))));
await t("seller reads the count (to see what's left)", () => assertSucceeds(getDoc(doc(s1, "inventory/c1"))));
await t("customer can't read the count", () => assertFails(getDoc(doc(cust, "inventory/c1"))));
await t("seller can't change the stock", () => assertFails(updateDoc(doc(s1, "inventory/c1"), { items: { L01: 999 } })));
await t("owner adds stock that arrived mid-shift", () => assertSucceeds(updateDoc(doc(owner, "inventory/c1"), { items: { L01: 70, B02: 24 } })));
await t("result can't be saved without ending the shift", () => assertFails(updateDoc(doc(owner, "inventory/c1"), { result: { L01: { used: 3, remaining: 67 } } })));
await t("owner can't end the count (only the seller, with the shift)", () => assertFails(updateDoc(doc(owner, "inventory/c1"),
  { closedAt: serverTimestamp(), result: { L01: { used: 3, remaining: 67 }, B02: { used: 0, remaining: 24 } } })));
await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), "inventory/c1"), { closedAt: new Date() }));
await t("a closed count can't be changed", () => assertFails(updateDoc(doc(owner, "inventory/c1"), { items: { L01: 1 } })));
await t("owner deletes a count", () => assertSucceeds(deleteDoc(doc(owner, "inventory/c1"))));

console.log("Menu");
const menu = { sections: [{ id: "lugaw", name: "Lugaw", box: true, note: "", items: [{ id: "L01", name: "Plain Lugaw", price: 45, inc: "", best: false, was: [39] }] }], retired: [], updatedAt: serverTimestamp() };
await t("owner saves the menu", () => assertSucceeds(setDoc(doc(owner, "settings/menu"), menu)));
await t("seller can't change the menu", () => assertFails(setDoc(doc(s1, "settings/menu"), menu)));
await t("kitchen can't change the menu", () => assertFails(setDoc(doc(k1, "settings/menu"), menu)));
await t("anyone can read the menu", () => assertSucceeds(getDoc(doc(cust, "settings/menu"))));
await t("owner saves the ingredient list", () => assertSucceeds(setDoc(doc(owner, "settings/ingredients"), { list: [{ id: "egg", name: "Egg", unit: "pcs" }], updatedAt: serverTimestamp() })));
await t("seller can't change the ingredient list", () => assertFails(setDoc(doc(s1, "settings/ingredients"), { list: [] })));

console.log("Sold-out list");
const stock = { soldOut: ["L02", "L09"], updatedAt: serverTimestamp() };
await t("seller publishes the sold-out items", () => assertSucceeds(setDoc(doc(s1, "settings/stock"), stock)));
await t("customer reads the sold-out items", () => assertSucceeds(getDoc(doc(cust, "settings/stock"))));
await t("sold-out list with other fields refused", () => assertFails(setDoc(doc(s1, "settings/stock"), { ...stock, open: false })));
await t("saving it again within 2 seconds is refused (no loops)", () => assertFails(setDoc(doc(s1, "settings/stock"), { ...stock, soldOut: [] })));
await new Promise(r => setTimeout(r, 2200));
await t("seller publishes what's left of each ingredient", () => assertSucceeds(setDoc(doc(s1, "settings/stock"), { ...stock, left: { egg: 3, i_B02: 4 } })));
await t("what's left must be a map", () => assertFails(setDoc(doc(s1, "settings/stock"), { ...stock, left: [3, 4] })));
await t("sold-out list must be a list", () => assertFails(setDoc(doc(s1, "settings/stock"), { soldOut: "L02", updatedAt: serverTimestamp() })));
await t("kitchen can't publish the sold-out list", () => assertFails(setDoc(doc(k1, "settings/stock"), stock)));
await t("customer can't publish the sold-out list", () => assertFails(setDoc(doc(cust, "settings/stock"), stock)));
await t("owner can clear it", () => assertSucceeds(setDoc(doc(owner, "settings/stock"), { soldOut: [], updatedAt: serverTimestamp() })));

console.log("Seller ends the count with their shift");
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "inventory/e1"), { ...count(), since: new Date(), createdAt: new Date() }));
const end = (over = {}) => ({ closedAt: serverTimestamp(), closedBy: "s1", result: { L01: { used: 5, remaining: 45 } }, ...over });
await t("seller can't change the stock while ending", () => assertFails(updateDoc(doc(s1, "inventory/e1"), { ...end(), items: { L01: 999 } })));
await t("seller can't end it in someone else's name", () => assertFails(updateDoc(doc(s1, "inventory/e1"), end({ closedBy: "owner" }))));
await t("kitchen staff can't end the count", () => assertFails(updateDoc(doc(k1, "inventory/e1"), end({ closedBy: "k1" }))));
await t("seller ends the count with its breakdown", () => assertSucceeds(updateDoc(doc(s1, "inventory/e1"), end())));
await t("an ended count can't be ended again", () => assertFails(updateDoc(doc(s1, "inventory/e1"), end())));

console.log("Refill list for the kitchen");
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "inventory/r1"), { ...count(), since: new Date(), createdAt: new Date() }));
const refill = { status: "pending", items: { egg: 12, rice: 8 } };
await t("seller ends the count and sends the refill list", () => assertSucceeds(updateDoc(doc(s1, "inventory/r1"), end({ refill }))));
await t("kitchen reads the refill list", () => assertSucceeds(getDoc(doc(k1, "inventory/r1"))));
await t("a customer can't read inventory", () => assertFails(getDoc(doc(cust, "inventory/r1"))));
const done = (over = {}) => ({ refill: { status: "done", items: refill.items, bought: { egg: 12, rice: 10 }, doneBy: "k1", doneByName: "K", doneAt: serverTimestamp(), ...over } });
await t("kitchen can't change what the list asked for", () => assertFails(updateDoc(doc(k1, "inventory/r1"), done({ items: { egg: 1 } }))));
await t("kitchen can't mark it in someone else's name", () => assertFails(updateDoc(doc(k1, "inventory/r1"), done({ doneBy: "s1" }))));
await t("a seller can't mark it refilled", () => assertFails(updateDoc(doc(s1, "inventory/r1"), done({ doneBy: "s1" }))));
await t("the owner can't mark it refilled (the kitchen does)", () => assertFails(updateDoc(doc(owner, "inventory/r1"), done({ doneBy: "owner" }))));
await t("kitchen marks everything refilled", () => assertSucceeds(updateDoc(doc(k1, "inventory/r1"), done())));
await t("it can't be marked refilled twice", () => assertFails(updateDoc(doc(k1, "inventory/r1"), done())));
await t("kitchen starts the next count with the refilled stock", () => assertSucceeds(setDoc(doc(k1, "inventory/r2"), count({ by: "k1", items: { egg: 30, rice: 20 }, refillOf: "r1" }))));
await t("a seller can't start a count", () => assertFails(setDoc(doc(s1, "inventory/r3"), count({ by: "s1" }))));
await t("a refill list that's already marked done can't be sent", () => assertFails(updateDoc(doc(owner, "inventory/r2"), { closedAt: serverTimestamp(), result: {}, refill: { status: "done", items: {} } })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
