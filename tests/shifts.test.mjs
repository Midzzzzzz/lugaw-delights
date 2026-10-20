// Cashier shifts: open with starting cash, pay in / pay out, close once with the counted cash.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion } from "firebase/firestore";

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
  await setDoc(doc(db, "sellers/s2"), { name: "Ben", phone: "09170000002", email: "", status: "approved" });
  await setDoc(doc(db, "kitchen/k1"), { name: "Cook", phone: "09170000003", email: "", status: "approved" });
});
const s1 = as("s1"), s2 = as("s2"), owner = as("owner"), cook = as("k1"), cust = as("cust", "anonymous");
const open = (by = "s1", over = {}) => ({ openedAt: serverTimestamp(), openedBy: by, openedByName: "Ana", startCash: 1000, moves: [], closedAt: null, ...over });
const move = (over = {}) => ({ type: "out", amount: 200, note: "Bought ice", by: "s1", byName: "Ana", at: Date.now(), ...over });

console.log("Opening");
await t("seller opens a shift with ₱1,000 starting cash", () => assertSucceeds(setDoc(doc(s1, "shifts/a"), open())));
await t("opening in someone else's name refused", () => assertFails(setDoc(doc(s1, "shifts/b"), open("s2"))));
await t("negative starting cash refused", () => assertFails(setDoc(doc(s1, "shifts/b"), open("s1", { startCash: -5 }))));
await t("opening an already closed shift refused", () => assertFails(setDoc(doc(s1, "shifts/b"), open("s1", { closedAt: serverTimestamp() }))));
await t("kitchen staff can't open a shift", () => assertFails(setDoc(doc(cook, "shifts/c"), open("k1"))));
await t("customer can't read shifts", () => assertFails(getDoc(doc(cust, "shifts/a"))));
await t("another seller reads the shift", () => assertSucceeds(getDoc(doc(s2, "shifts/a"))));

console.log("Pay in / pay out");
await t("seller records a ₱200 pay out", () => assertSucceeds(updateDoc(doc(s1, "shifts/a"), { moves: [move()] })));
await t("another seller adds a pay in", () => assertSucceeds(updateDoc(doc(s2, "shifts/a"), { moves: [move(), move({ type: "in", amount: 500, note: "Change fund", by: "s2", byName: "Ben" })] })));
await t("an entry can't be removed", () => assertFails(updateDoc(doc(s1, "shifts/a"), { moves: [move()] })));
await t("an entry in someone else's name refused", () => assertFails(updateDoc(doc(s1, "shifts/a"), { moves: [move(), move({ type: "in", amount: 500, note: "Change fund", by: "s2", byName: "Ben" }), move({ by: "s2" })] })));
await t("the starting cash can't be changed", () => assertFails(updateDoc(doc(s1, "shifts/a"), { startCash: 5000 })));

console.log("Closing");
const close = (by = "s1", over = {}) => ({ closedAt: serverTimestamp(), closedBy: by, closedByName: "Ana", countedCash: 2350, summary: { expected: 2400 }, ...over });
await t("closing in someone else's name refused", () => assertFails(updateDoc(doc(s1, "shifts/a"), close("s2"))));
await t("seller closes the shift with the counted cash", () => assertSucceeds(updateDoc(doc(s1, "shifts/a"), close())));
await t("a closed shift can't be closed again", () => assertFails(updateDoc(doc(s1, "shifts/a"), close("s1", { countedCash: 2400 }))));
await t("no pay out after closing", () => assertFails(updateDoc(doc(s1, "shifts/a"), { moves: arrayUnion(move({ at: 1 })) })));
await t("a seller can't delete a shift", () => assertFails(deleteDoc(doc(s1, "shifts/a"))));
await t("owner deletes a shift", () => assertSucceeds(deleteDoc(doc(owner, "shifts/a"))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
