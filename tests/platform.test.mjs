// Foodpanda and Grab orders: the seller enters them at menu prices so the kitchen and the
// inventory see them. Saved as paid by the platform, never cash; the platform may cancel them.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" }));
const s1 = as("s1");
const order = over => ({ code: "LD-P", customerUid: "s1", sellerUid: "s1", sellerName: "S", mode: "Dine-in", table: "", notes: "", payment: "Foodpanda",
  source: "foodpanda", paid: true, paidAt: serverTimestamp(), paidTotal: 49,
  items: [{ id: "L01", name: "Plain Lugaw", price: 39, qty: 1, pack: "box" }], subtotal: 39, deliveryFee: 0, boxFee: 10, total: 49,
  status: "preparing", riderUid: null, createdAt: serverTimestamp(), ...over });

console.log("Foodpanda / Grab orders");
await t("Foodpanda order with its order number", () => assertSucceeds(setDoc(doc(s1, "orders/p1"), order({ platformRef: "#a1b2-c3d4" }))));
await t("Grab order without an order number", () => assertSucceeds(setDoc(doc(s1, "orders/p2"), order({ source: "grab", payment: "Grab" }))));
await t("source and payment must match", () => assertFails(setDoc(doc(s1, "orders/p3"), order({ source: "grab", payment: "Foodpanda" }))));
await t("unknown platform refused", () => assertFails(setDoc(doc(s1, "orders/p4"), order({ source: "lalamove", payment: "Lalamove" }))));
await t("platform order must be marked paid", () => assertFails(setDoc(doc(s1, "orders/p5"), (({ paid, paidAt, paidTotal, ...o }) => o)(order()))));
await t("platform order can't record cash", () => assertFails(setDoc(doc(s1, "orders/p6"), order({ cashGiven: 50 }))));
await t("a counter order can't say Foodpanda without the source", () => assertFails(setDoc(doc(s1, "orders/p7"), (({ source, ...o }) => o)(order()))));
await t("a cash order can't carry a platform order number", () => assertFails(setDoc(doc(s1, "orders/p8"),
  (({ source, paid, paidAt, ...o }) => o)(order({ payment: "Cash", cashGiven: 50, platformRef: "x" })))));
await t("too-long order number refused", () => assertFails(setDoc(doc(s1, "orders/p9"), order({ platformRef: "x".repeat(31) }))));
await t("the platform can't be changed afterwards", () => assertFails(updateDoc(doc(s1, "orders/p1"), { source: "grab", payment: "Grab" })));
await t("the order number can't be changed afterwards", () => assertFails(updateDoc(doc(s1, "orders/p1"), { platformRef: "other" })));
await t("a platform order can be cancelled (the platform cancelled it)", () => assertSucceeds(updateDoc(doc(s1, "orders/p2"), { status: "cancelled", cancelReason: "Cancelled on Grab" })));
await env.withSecurityRulesDisabled(async c => { const { source, paid, paidAt, ...o } = order({ payment: "Cash", cashGiven: 50, paidTotal: 49 }); await setDoc(doc(c.firestore(), "orders/c1"), { ...o, createdAt: new Date() }); });
await t("a paid cash order still can't be cancelled", () => assertFails(updateDoc(doc(s1, "orders/c1"), { status: "cancelled" })));

console.log(`
${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
