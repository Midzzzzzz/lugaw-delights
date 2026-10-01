import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const seed = f => env.withSecurityRulesDisabled(c => f(c.firestore()));
await seed(async db => {
  await setDoc(doc(db, "admins/owner"), { name: "Owner" });
  await setDoc(doc(db, "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" });
  await setDoc(doc(db, "riders/r1"), { name: "R1", phone: "09171234567", status: "approved", online: true });
  await setDoc(doc(db, "riders/r2"), { name: "R2", phone: "09179999999", status: "approved", online: true });
  await setDoc(doc(db, "orders/o1"), { code: "LD-1", customerUid: "cust", mode: "Delivery", status: "assigned", riderUid: "r1", total: 118 });
});
// a real (tiny) JPEG-looking data URL
const PHOTO = "data:image/jpeg;base64," + Buffer.alloc(3000, 7).toString("base64");
const snap = (who, kind, over = {}) => setDoc(doc(as(who), "proofs", `o1_${kind}`),
  { orderId: "o1", kind, riderUid: who, photo: PHOTO, takenAt: serverTimestamp(), ...over });

await t("rider can't send a delivery photo before pickup", () => assertFails(snap("r1", "delivery")));
await t("another rider can't send a photo for this order", () => assertFails(snap("r2", "pickup")));
await t("photo that isn't a JPEG refused", () => assertFails(snap("r1", "pickup", { photo: "data:image/png;base64,AAAA" })));
await t("photo saved under the wrong name refused", () => assertFails(setDoc(doc(as("r1"), "proofs/o1_x"), { orderId: "o1", kind: "pickup", riderUid: "r1", photo: PHOTO, takenAt: serverTimestamp() })));
await t("photo too big refused", () => assertFails(snap("r1", "pickup", { photo: "data:image/jpeg;base64," + "A".repeat(820000) })));
await t("rider sends the pickup photo", () => assertSucceeds(snap("r1", "pickup")));
await t("rider can't replace the pickup photo", () => assertFails(snap("r1", "pickup")));
await t("rider can't delete it", () => assertFails(deleteDoc(doc(as("r1"), "proofs/o1_pickup"))));
await seed(db => updateDoc(doc(db, "orders/o1"), { status: "picked_up" }));
await t("rider sends the delivery photo", () => assertSucceeds(snap("r1", "delivery")));
await t("seller sees the photos", () => assertSucceeds(getDoc(doc(as("s1"), "proofs/o1_delivery"))));
await t("owner sees the photos", () => assertSucceeds(getDoc(doc(as("owner"), "proofs/o1_pickup"))));
await t("rider sees their own photo", () => assertSucceeds(getDoc(doc(as("r1"), "proofs/o1_pickup"))));
await t("other rider can't see it", () => assertFails(getDoc(doc(as("r2"), "proofs/o1_pickup"))));
await t("customer can't see it", () => assertFails(getDoc(doc(as("cust", "anonymous"), "proofs/o1_pickup"))));
await t("owner can't change or delete a photo", async () => { await assertFails(updateDoc(doc(as("owner"), "proofs/o1_pickup"), { photo: PHOTO })); await assertFails(deleteDoc(doc(as("owner"), "proofs/o1_pickup"))); });
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
