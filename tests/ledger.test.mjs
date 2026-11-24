// Owner's savings book: only the owner can read or write it; entries are added or deleted, never edited.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, serverTimestamp } from "firebase/firestore";

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
const o = as("owner");
const entry = (over = {}) => ({ type: "saving", amount: 1500, date: "2026-10-14", note: "From sales", createdAt: serverTimestamp(), createdBy: "owner", ...over });

await t("owner saves from sales", () => assertSucceeds(setDoc(doc(o, "ledger/s1"), entry())));
await t("owner records an expense", () => assertSucceeds(setDoc(doc(o, "ledger/e1"), entry({ type: "expense", amount: 800, category: "Ingredients", note: "Rice" }))));
await t("expense without a category refused", () => assertFails(setDoc(doc(o, "ledger/e2"), entry({ type: "expense" }))));
await t("saving with a category refused", () => assertFails(setDoc(doc(o, "ledger/s2"), entry({ category: "Rent" }))));
await t("zero amount refused", () => assertFails(setDoc(doc(o, "ledger/s3"), entry({ amount: 0 }))));
await t("centavos refused (whole pesos)", () => assertFails(setDoc(doc(o, "ledger/s4"), entry({ amount: 10.5 }))));
await t("bad date refused", () => assertFails(setDoc(doc(o, "ledger/s5"), entry({ date: "Oct 14" }))));
await t("entry in someone else's name refused", () => assertFails(setDoc(doc(o, "ledger/s6"), entry({ createdBy: "s1" }))));
await t("unknown type refused", () => assertFails(setDoc(doc(o, "ledger/s7"), entry({ type: "loan" }))));
await t("saving with where its money is", () => assertSucceeds(setDoc(doc(o, "ledger/f1"), entry({ amount: 1000, from: { platform: 600, gcash: 300, cash: 100 } }))));
await t("parts that don't add up refused", () => assertFails(setDoc(doc(o, "ledger/f2"), entry({ amount: 1000, from: { platform: 600, gcash: 300, cash: 50 } }))));
await t("negative part refused", () => assertFails(setDoc(doc(o, "ledger/f3"), entry({ amount: 1000, from: { platform: 1100, gcash: -100, cash: 0 } }))));
await t("unknown part refused", () => assertFails(setDoc(doc(o, "ledger/f4"), entry({ amount: 1000, from: { platform: 0, gcash: 0, bank: 1000 } }))));
await t("expense paid with GCash", () => assertSucceeds(setDoc(doc(o, "ledger/f5"), entry({ type: "expense", amount: 300, category: "Salaries", note: "Salary", paidFrom: "gcash" }))));
await t("expense paid with something unknown refused", () => assertFails(setDoc(doc(o, "ledger/f6"), entry({ type: "expense", amount: 300, category: "Salaries", note: "x", paidFrom: "bank" }))));
await t("saving can't have paidFrom", () => assertFails(setDoc(doc(o, "ledger/f7"), entry({ paidFrom: "cash" }))));
await t("owner corrects where the savings are", () => assertSucceeds(setDoc(doc(o, "savingsSplit/offset"), { platform: -500, gcash: 200, cash: 300, at: serverTimestamp(), by: "owner" })));
await t("a correction that changes the balance refused", () => assertFails(setDoc(doc(o, "savingsSplit/offset"), { platform: 0, gcash: 200, cash: 300, at: serverTimestamp(), by: "owner" })));
await t("seller can't read the correction", () => assertFails(getDoc(doc(as("s1"), "savingsSplit/offset"))));
await t("seller can't correct it", () => assertFails(setDoc(doc(as("s1"), "savingsSplit/offset"), { platform: 0, gcash: 0, cash: 0, at: serverTimestamp(), by: "s1" })));
await t("entries can't be edited", () => assertFails(updateDoc(doc(o, "ledger/s1"), { amount: 99999 })));
await t("owner reads the book", () => assertSucceeds(getDocs(collection(o, "ledger"))));
await t("seller can't read the book", () => assertFails(getDoc(doc(as("s1"), "ledger/s1"))));
await t("seller can't add to it", () => assertFails(setDoc(doc(as("s1"), "ledger/x"), entry({ createdBy: "s1" }))));
await t("customer can't read it", () => assertFails(getDoc(doc(as("c", "anonymous"), "ledger/s1"))));
await t("seller can't delete an entry", () => assertFails(deleteDoc(doc(as("s1"), "ledger/s1"))));
await t("owner deletes a wrong entry", () => assertSucceeds(deleteDoc(doc(o, "ledger/e1"))));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
