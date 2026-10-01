import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = u => env.authenticatedContext(u, { firebase: { sign_in_provider: "password" } }).firestore();
const GC = { payMethod: "GCash", payName: "Juan Dela Cruz", payNumber: "09171234567", payBank: "" };
const apply = (u, area, pay = GC) => setDoc(doc(as(u), "riders", u), { name: "R", phone: "09171234567", email: "r@x.com", area, vehicle: "Motorcycle", ...pay,
  plate: "", license: "", status: "pending", online: false, createdAt: serverTimestamp() });

for (const a of ["Los Baños", "Bay", "Los Baños & Bay"]) await t(`rider applies for "${a}"`, () => assertSucceeds(apply("r_" + a.length, a)));
await t("typed-in area refused", () => assertFails(apply("r_x", "Brgy. Commonwealth, Batasan")));
await t("empty area refused", () => assertFails(apply("r_y", "")));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "riders/old"), { name: "Old", phone: "09171234567", area: "Anywhere", status: "approved", online: false }));
await t("older rider with a typed area can still switch Available", () => assertSucceeds(updateDoc(doc(as("old"), "riders/old"), { online: true })));
await t("rider can't change area to something off the list", () => assertFails(updateDoc(doc(as("old"), "riders/old"), { area: "Taguig" })));
await t("rider can change area to Bay", () => assertSucceeds(updateDoc(doc(as("old"), "riders/old"), { area: "Bay" })));
console.log("Payout accounts");
const BANK = { payMethod: "Bank", payName: "Juan Dela Cruz", payNumber: "001234567890", payBank: "BDO" };
await t("rider applies with a bank account", () => assertSucceeds(apply("p1", "Bay", BANK)));
await t("rider without a payout account refused", () => assertFails(setDoc(doc(as("p2"), "riders/p2"), { name: "R", phone: "09171234567", email: "r@x.com", area: "Bay",
  vehicle: "Motorcycle", plate: "", license: "", status: "pending", online: false, createdAt: serverTimestamp() })));
await t("GCash number that isn't a mobile number refused", () => assertFails(apply("p3", "Bay", { ...GC, payNumber: "12345" })));
await t("bank account without a bank name refused", () => assertFails(apply("p4", "Bay", { ...BANK, payBank: "" })));
await t("bank account number with letters refused", () => assertFails(apply("p5", "Bay", { ...BANK, payNumber: "12AB5678" })));
await t("payout without an account name refused", () => assertFails(apply("p6", "Bay", { ...GC, payName: "" })));
const now = { payUpdatedAt: serverTimestamp() };
await t("rider adds a payout account", () => assertSucceeds(updateDoc(doc(as("old"), "riders/old"), { ...GC, ...now })));
await t("rider changes their payout account to a bank", () => assertSucceeds(updateDoc(doc(as("old"), "riders/old"), { ...BANK, ...now })));
await t("payout change without a time stamp refused", () => assertFails(updateDoc(doc(as("old"), "riders/old"), { payNumber: "009876543210" })));
await t("payout change to an invalid account refused", () => assertFails(updateDoc(doc(as("old"), "riders/old"), { payNumber: "12", ...now })));
await t("rider updates their mobile number", () => assertSucceeds(updateDoc(doc(as("old"), "riders/old"), { phone: "09181112222" })));
await t("rider can't change their status", () => assertFails(updateDoc(doc(as("old"), "riders/old"), { status: "rejected", phone: "09181113333" })));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "admins/owner"), { name: "Owner" }));
await t("owner can't change a rider's payout account", () => assertFails(updateDoc(doc(as("owner"), "riders/old"), { ...GC, ...now })));
await t("owner can still suspend a rider", () => assertSucceeds(updateDoc(doc(as("owner"), "riders/old"), { status: "suspended", online: false })));
await t("suspended rider can't change payout", () => assertFails(updateDoc(doc(as("old"), "riders/old"), { ...GC, ...now })));
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "riders/nopay"), { name: "No Pay", phone: "09170000000", area: "Bay", status: "approved", online: true });
  await setDoc(doc(db, "agreements/nopay"), { version: "x" });
  await setDoc(doc(db, "orders/w1"), { code: "LD-W", customerUid: "c", mode: "Delivery", status: "ready", riderUid: null, total: 118 });
});
await t("approved rider without a payout account can't accept orders", () => assertFails(updateDoc(doc(as("nopay"), "orders/w1"),
  { status: "assigned", riderUid: "nopay", riderName: "No Pay", riderPhone: "09170000000", assignedAt: serverTimestamp() })));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
