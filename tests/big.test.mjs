// Large orders: the rules check every order line, and Firestore stops a rule after
// 1000 steps, so make sure orders with up to 20 different items still go through.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, writeBatch, serverTimestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-lugaw",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "settings/delivery"), { fees: { "lb-anos": 40 } }));
let pass = 0, fail = 0;
for (const n of [1, 2, 5, 10, 15, 20]) {
  const uid = "big" + n, db = env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore(), b = writeBatch(db), id = "ord" + uid;
  const items = Array.from({ length: n }, (_, i) => ({ id: "X" + i, name: "n", price: 10, qty: 1 }));
  b.set(doc(db, "orders", id), { code: "c", customerUid: uid, mode: "Delivery", address: "a", notes: "", payment: "Cash", zone: "lb-anos", zoneName: "Anos, Los Baños",
    items, subtotal: 10 * n, deliveryFee: 40, total: 10 * n + 40, status: "new", riderUid: null, createdAt: serverTimestamp(), hasPin: true });
  b.set(doc(db, "contacts", id), { name: "J", phone: "09170001111", customerUid: uid, createdAt: serverTimestamp() });
  b.set(doc(db, "customers", uid), { lastOrderAt: serverTimestamp(), lastOrderId: id });
  b.set(doc(db, "pins", id), { pin: "1234", customerUid: uid });
  try { await assertSucceeds(b.commit()); pass++; console.log(`  ok   order with ${n} different items`); }
  catch (e) { fail++; console.log(`  FAIL order with ${n} different items`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
