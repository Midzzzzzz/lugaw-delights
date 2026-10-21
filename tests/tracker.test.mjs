// Stock tracker: the owner sets standard stock once; closing a shift asks the kitchen to refill;
// the kitchen refills and resets the stock on hand.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "sellers/s1"), { name: "Ana", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "kitchen/k1"), { name: "Ben", phone: "09170000002", email: "", status: "approved" });
});
const owner = as("owner"), s1 = as("s1"), k1 = as("k1"), cust = as("cust", "anonymous");
const inv = doc(owner, "settings/inventory");

console.log("Owner sets standard stock once");
await t("owner sets the standard stock", () => assertSucceeds(setDoc(inv, { par: { egg: 60, liempo: 20 }, base: { egg: 60, liempo: 20 }, since: serverTimestamp(), refillDue: false })));
await t("owner changes a standard amount later", () => assertSucceeds(updateDoc(inv, { par: { egg: 80, liempo: 20 } })));
await t("a seller can't change the standard stock", () => assertFails(updateDoc(doc(s1, "settings/inventory"), { par: { egg: 1 } })));
await t("the kitchen can't change the standard stock", () => assertFails(updateDoc(doc(k1, "settings/inventory"), { par: { egg: 1 } })));

console.log("Seller asks for a refill when closing the shift");
const ask = (by = "s1") => ({ refillDue: true, refillAskedAt: serverTimestamp(), refillAskedBy: by, refillAskedByName: "Ana" });
await t("seller can't change the stock on hand", () => assertFails(updateDoc(doc(s1, "settings/inventory"), { ...ask(), base: { egg: 999 } })));
await t("seller can't ask in someone else's name", () => assertFails(updateDoc(doc(s1, "settings/inventory"), ask("k1"))));
await t("seller asks the kitchen to refill", () => assertSucceeds(updateDoc(doc(s1, "settings/inventory"), ask())));
await t("a customer can't ask for a refill", () => assertFails(updateDoc(doc(cust, "settings/inventory"), ask("cust"))));

console.log("Kitchen refills");
const refill = (over = {}) => ({ base: { egg: 80, liempo: 20 }, since: serverTimestamp(), refillDue: false, refilledAt: serverTimestamp(), refilledBy: "k1", refilledByName: "Ben", ...over });
await t("kitchen saves part of the refill; the rest stays due", () => assertSucceeds(updateDoc(doc(k1, "settings/inventory"), refill({ base: { egg: 70, liempo: 20 }, refillDue: true }))));
await t("kitchen can't refill in someone else's name", () => assertFails(updateDoc(doc(k1, "settings/inventory"), refill({ refilledBy: "s1" }))));
await t("a seller can't mark it refilled", () => assertFails(updateDoc(doc(s1, "settings/inventory"), refill({ refilledBy: "s1" }))));
await t("kitchen refills and resets the stock on hand", () => assertSucceeds(updateDoc(doc(k1, "settings/inventory"), refill())));
await t("kitchen can't ask for a refill itself", () => assertFails(updateDoc(doc(k1, "settings/inventory"), refill({ refillDue: true }))));
const rec = (over = {}) => ({ at: serverTimestamp(), by: "k1", byName: "Ben", bought: { egg: 20 }, before: { egg: 60, liempo: 20 }, after: { egg: 80, liempo: 20 }, ...over });
await t("kitchen records the refill in the history", () => assertSucceeds(addDoc(collection(k1, "refills"), rec())));
await t("a seller can't add to the refill history", () => assertFails(addDoc(collection(s1, "refills"), rec({ by: "s1" }))));
await t("owner reads the refill history", () => assertSucceeds(getDoc(doc(owner, "refills/none"))));
await t("a customer can't read the refill history", () => assertFails(getDoc(doc(cust, "refills/none"))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
