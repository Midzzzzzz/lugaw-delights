// Changing a dine-in order after it's paid: the payment stays, paidTotal records what it
// covered, and the difference is settled (extra paid, or money given back).
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ok  ", n); } catch (e) { fail++; console.log("  FAIL", n); } };
const as = (u, p = "password") => env.authenticatedContext(u, { firebase: { sign_in_provider: p } }).firestore();
const lugaw = { id: "L01", name: "Plain Lugaw", price: 39, qty: 2 }, coke = { id: "B02", name: "Coke", price: 25, qty: 1 };
const dine = over => ({ code: "LD-P", customerUid: "s1", sellerUid: "s1", sellerName: "S", mode: "Dine-in", table: "", notes: "", payment: "Cash",
  items: [lugaw, coke], subtotal: 103, deliveryFee: 0, total: 103, status: "preparing", riderUid: null, createdAt: serverTimestamp(), ...over });
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "sellers/s1"), { name: "S", phone: "09170000001", email: "", status: "approved" }));
const s1 = as("s1"), up = (id, data) => updateDoc(doc(s1, "orders", id), data);
const removeCoke = { items: [lugaw], subtotal: 78, total: 78,
  removed: [{ ...coke, by: "S", at: 1 }], editedAt: serverTimestamp(), editedBy: "s1", editedByName: "S" };

console.log("Paying when the order is made");
await t("cash paid with paidTotal = total", () => assertSucceeds(setDoc(doc(s1, "orders/p1"), dine({ cashGiven: 200, paidTotal: 103 }))));
await t("GCash paid with paidTotal = total", () => assertSucceeds(setDoc(doc(s1, "orders/p2"), dine({ payment: "GCash", paid: true, paidAt: serverTimestamp(), paidTotal: 103 }))));
await t("paidTotal different from the total refused", () => assertFails(setDoc(doc(s1, "orders/p3"), dine({ cashGiven: 200, paidTotal: 50 }))));
await t("paidTotal without a payment refused", () => assertFails(setDoc(doc(s1, "orders/p4"), dine({ paidTotal: 103 }))));

console.log("Changing after paying");
await t("remove the Coke from a cash-paid order (logged)", () => assertSucceeds(up("p1", removeCoke)));
await t("removing without logging it is still refused", () => assertFails(up("p2", { items: [lugaw], subtotal: 78, total: 78 })));
await t("the paidTotal can't be changed along with the items", () => assertFails(up("p2", { ...removeCoke, paidTotal: 78 })));
await t("remove the Coke from a GCash-paid order (logged)", () => assertSucceeds(up("p2", removeCoke)));

console.log("Settling the balance");
await t("gave back the ₱25: settledTotal = the new total", () => assertSucceeds(up("p1", { settledTotal: 78 })));
await t("paidTotal (what was first paid) can't be rewritten", () => assertFails(up("p2", { paidTotal: 78 })));
await t("settledTotal can't be some other amount", () => assertFails(up("p2", { settledTotal: 10 })));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/u1"), { ...dine(), createdAt: new Date() }));
await t("an unpaid order can't settle a balance", () => assertFails(up("u1", { settledTotal: 103 })));
await t("cash paid later sets paidTotal with it", () => assertSucceeds(up("u1", { cashGiven: 103, paidTotal: 103 })));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/u2"), { ...dine(), createdAt: new Date() }));
await t("paidTotal without the payment refused", () => assertFails(up("u2", { paidTotal: 103 })));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "orders/d1"), { ...dine(), mode: "Pickup", cashGiven: 103, paidTotal: 103, createdAt: new Date() }));
await t("not for online orders", () => assertFails(up("d1", { settledTotal: 103 })));
await t("customer can't settle a balance", () => assertFails(updateDoc(doc(as("cust", "anonymous"), "orders/p2"), { settledTotal: 78 })));
// Items added after paying, then the extra paid
await t("add a Coke to the cash order after paying", () => assertSucceeds(up("p1", { items: [lugaw, { ...coke, round: 2 }], subtotal: 103, total: 103, status: "preparing", addedAt: serverTimestamp() })));
await t("got the extra ₱25: settledTotal = 103", () => assertSucceeds(up("p1", { settledTotal: 103 })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
