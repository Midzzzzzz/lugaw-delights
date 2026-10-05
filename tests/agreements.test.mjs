import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = u => env.authenticatedContext(u, { firebase: { sign_in_provider: "password" } }).firestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "riders/r1"), { name: "Rider One", phone: "09171234567", payMethod: "GCash", payName: "Rider", payNumber: "09171234567", payBank: "", status: "approved", online: true });
  await setDoc(doc(db, "riders/r2"), { name: "Rider Two", phone: "09179999999", payMethod: "GCash", payName: "Rider", payNumber: "09171234567", payBank: "", status: "approved", online: true });
  await setDoc(doc(db, "riders/pend"), { name: "Pending", phone: "09170000000", status: "pending", online: false });
  await setDoc(doc(db, "orders/o1"), { code: "LD-1", customerUid: "c", mode: "Delivery", status: "new", riderUid: null, total: 118, createdAt: Timestamp.now() });
});
const text = "RIDER SERVICE AND CASH-HANDLING AGREEMENT\n\n" + "Clause text. ".repeat(60);
const sig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const sign = (u, over = {}) => setDoc(doc(as(u), "agreements", u), { riderUid: u, version: "2026-09-30", signedName: "Rider One",
  contractText: text, signature: sig, phone: "09171234567", license: "N01-23", plate: "ABC 123", vehicle: "Motorcycle", signedAt: serverTimestamp(), ...over });
const accept = u => updateDoc(doc(as(u), "orders/o1"), { status: "assigned", riderUid: u, riderName: u === "r1" ? "Rider One" : "Rider Two",
  riderPhone: u === "r1" ? "09171234567" : "09179999999", assignedAt: serverTimestamp() });

console.log("Before signing");
await t("approved rider who hasn't signed can't accept an order", () => assertFails(accept("r1")));
await t("pending rider can't sign yet", () => assertFails(sign("pend", { riderUid: "pend" })));
console.log("Signing");
await t("signature that isn't an image refused", () => assertFails(sign("r1", { signature: "hello" })));
await t("empty agreement text refused", () => assertFails(sign("r1", { contractText: "short" })));
await t("can't sign for another rider", () => assertFails(setDoc(doc(as("r2"), "agreements", "r1"), { riderUid: "r1", version: "2026-09-30", signedName: "X", contractText: text, signature: sig, phone: "", license: "", plate: "", vehicle: "", signedAt: serverTimestamp() })));
await t("approved rider signs", () => assertSucceeds(sign("r1")));
await t("rider can't edit their signed copy", () => assertFails(sign("r1", { signedName: "Someone Else" })));
await t("rider can't delete their signed copy", () => assertFails(deleteDoc(doc(as("r1"), "agreements/r1"))));
await t("rider signs a new version of the agreement", () => assertSucceeds(sign("r1", { version: "2027-01-01" })));
console.log("Who can read it");
await t("rider reads their own agreement", () => assertSucceeds(getDoc(doc(as("r1"), "agreements/r1"))));
await t("owner reads the agreement", () => assertSucceeds(getDoc(doc(as("owner"), "agreements/r1"))));
await t("another rider can't read it", () => assertFails(getDoc(doc(as("r2"), "agreements/r1"))));
await t("seller can't read it", () => assertFails(getDoc(doc(as("s1"), "agreements/r1"))));
console.log("After signing");
await t("signed rider accepts an order", () => assertSucceeds(accept("r1")));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
