import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "sellers/s1"), { name: "Seller One", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "riders/r1"), { name: "R", phone: "09171234567", status: "approved", online: true });
});
const confirm = (db, uid, key = "9171234567", over = {}) => setDoc(doc(db, "phones", key), { confirmedBy: uid, confirmedByName: "Seller One", confirmedAt: serverTimestamp(), ...over });

// phoneKey from common.js, copied here (common.js imports browser-only Firebase URLs)
function phoneKey(p) { let d = String(p || "").replace(/\D/g, ""); if (d.startsWith("63")) d = d.slice(2); if (d.startsWith("0")) d = d.slice(1); return /^9\d{9}$/.test(d) ? d : null; }
await t("phoneKey matches all formats of one number", async () => {
  const k = ["0917 123 4567", "+63 917 123 4567", "639171234567", "9171234567", "0917-123-4567"].map(phoneKey);
  if (!k.every(x => x === "9171234567")) throw new Error(k.join(","));
  if (phoneKey("12345") !== null || phoneKey("0817 123 4567") !== null) throw new Error("accepted a bad number");
});
await t("seller confirms a number", () => assertSucceeds(confirm(as("s1"), "s1")));
await t("seller reads confirmed numbers", () => assertSucceeds(getDoc(doc(as("s1"), "phones/9171234567"))));
await t("seller can't confirm in someone else's name", () => assertFails(confirm(as("s1"), "owner", "9170000002")));
await t("badly formed number key refused", () => assertFails(confirm(as("s1"), "s1", "12345")));
await t("owner confirms a number", () => assertSucceeds(confirm(as("owner"), "owner", "9170000003", { confirmedByName: "Owner" })));
await t("customer can't confirm their own number", () => assertFails(confirm(as("cust", "anonymous"), "cust", "9170000004")));
await t("customer can't read confirmed numbers", () => assertFails(getDoc(doc(as("cust", "anonymous"), "phones/9171234567"))));
await t("rider can't read confirmed numbers", () => assertFails(getDoc(doc(as("r1"), "phones/9171234567"))));
await t("seller can't delete a confirmation", () => assertFails(deleteDoc(doc(as("s1"), "phones/9171234567"))));
await t("owner can delete a confirmation", () => assertSucceeds(deleteDoc(doc(as("owner"), "phones/9171234567"))));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
