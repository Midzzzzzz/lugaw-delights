// Staff attendance: the owner sets up staff and their pay per duty; the counter times them in and out
// by scanning their QR card; only the owner corrects, marks paid or deletes.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, Timestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n, e?.message || e); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(async c => {
  await setDoc(doc(c.firestore(), "admins/owner"), { name: "Owner" });
  await setDoc(doc(c.firestore(), "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(c.firestore(), "kitchen/k1"), { name: "K", phone: "09170000002", email: "", status: "approved" });
});
const o = as("owner"), s = as("s1");
const crew = (over = {}) => ({ name: "Ana", rate: 400, code: "AB12CD34EF", active: true, createdAt: serverTimestamp(), ...over });
const duty = (over = {}) => ({ crewId: "ana", name: "Ana", rate: 400, inAt: serverTimestamp(), outAt: null, inBy: "s1", inByName: "S", ...over });

await t("owner adds a staff member", () => assertSucceeds(setDoc(doc(o, "crew/ana"), crew())));
await t("owner adds one who is no longer active", () => assertSucceeds(setDoc(doc(o, "crew/ben"), crew({ name: "Ben", code: "ZZ12CD34EF", active: false }))));
await t("owner changes the pay per duty", () => assertSucceeds(updateDoc(doc(o, "crew/ana"), { rate: 450 })));
await t("pay with centavos refused", () => assertFails(updateDoc(doc(o, "crew/ana"), { rate: 450.5 })));
await t("short QR code refused", () => assertFails(setDoc(doc(o, "crew/x"), crew({ code: "abc" }))));
await t("seller can't add staff", () => assertFails(setDoc(doc(s, "crew/y"), crew())));
await t("seller can't change the pay", () => assertFails(updateDoc(doc(s, "crew/ana"), { rate: 9000 })));
await t("seller reads the staff list", () => assertSucceeds(getDocs(collection(s, "crew"))));
await t("customer can't read the staff list", () => assertFails(getDocs(collection(as("c", "anonymous"), "crew"))));

await t("counter times Ana in at her pay", () => assertSucceeds(setDoc(doc(s, "attendance/d1"), duty({ rate: 450 }))));
await t("time in with a made-up pay refused", () => assertFails(setDoc(doc(s, "attendance/d2"), duty({ rate: 9000 }))));
await t("time in for someone not on the list refused", () => assertFails(setDoc(doc(s, "attendance/d3"), duty({ crewId: "nobody", rate: 450 }))));
await t("time in for someone no longer active refused", () => assertFails(setDoc(doc(s, "attendance/d4"), duty({ crewId: "ben", name: "Ben", rate: 400 }))));
await t("time in at another time refused", () => assertFails(setDoc(doc(s, "attendance/d5"), duty({ rate: 450, inAt: Timestamp.fromMillis(Date.now() - 3600000) }))));
await t("time in in someone else's name refused", () => assertFails(setDoc(doc(s, "attendance/d6"), duty({ rate: 450, inBy: "owner" }))));
await t("kitchen can't time in", () => assertFails(setDoc(doc(as("k1"), "attendance/d7"), duty({ rate: 450, inBy: "k1", inByName: "K" }))));
await t("seller can't change the pay on a duty", () => assertFails(updateDoc(doc(s, "attendance/d1"), { rate: 9000 })));
await t("counter times Ana out", () => assertSucceeds(updateDoc(doc(s, "attendance/d1"), { outAt: serverTimestamp(), outBy: "s1", outByName: "S" })));
await t("can't time out twice", () => assertFails(updateDoc(doc(s, "attendance/d1"), { outAt: serverTimestamp(), outBy: "s1", outByName: "S" })));
await t("seller can't delete a duty", () => assertFails(deleteDoc(doc(s, "attendance/d1"))));
await t("owner corrects the pay and marks it paid", () => assertSucceeds(updateDoc(doc(o, "attendance/d1"), { rate: 500, paidAt: serverTimestamp(), fixedNote: "Extra hour" })));
await t("owner unmarks paid", () => assertSucceeds(updateDoc(doc(o, "attendance/d1"), { paidAt: null })));
await t("owner can't change who it was", () => assertFails(updateDoc(doc(o, "attendance/d1"), { crewId: "ben" })));
await t("seller reads attendance", () => assertSucceeds(getDoc(doc(s, "attendance/d1"))));
const past = (over = {}) => ({ crewId: "ana", name: "Ana", rate: 450, inAt: Timestamp.fromMillis(Date.now() - 50 * 3600000), outAt: Timestamp.fromMillis(Date.now() - 42 * 3600000),
  inBy: "owner", inByName: "Owner", outBy: "owner", outByName: "Owner", byOwner: true, ...over });
await t("owner records a past duty", () => assertSucceeds(setDoc(doc(o, "attendance/p1"), past())));
await t("owner records one with no time out", () => assertSucceeds(setDoc(doc(o, "attendance/p2"), past({ outAt: null, outBy: null, outByName: null }))));
await t("owner records one at another pay", () => assertSucceeds(setDoc(doc(o, "attendance/p3"), past({ rate: 300 }))));
await t("duty in the future refused", () => assertFails(setDoc(doc(o, "attendance/p4"), past({ inAt: Timestamp.fromMillis(Date.now() + 3600000), outAt: null }))));
await t("time out before time in refused", () => assertFails(setDoc(doc(o, "attendance/p5"), past({ outAt: Timestamp.fromMillis(Date.now() - 60 * 3600000) }))));
await t("past duty for someone not on the list refused", () => assertFails(setDoc(doc(o, "attendance/p6"), past({ crewId: "nobody" }))));
await t("seller can't record a past duty", () => assertFails(setDoc(doc(s, "attendance/p7"), past({ inBy: "s1", inByName: "S" }))));
await t("owner deletes a wrong duty", () => assertSucceeds(deleteDoc(doc(o, "attendance/d1"))));
await t("owner removes a staff member", () => assertSucceeds(deleteDoc(doc(o, "crew/ben"))));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
