// "@firebase/rules-unit-testing" for the tests, against the Lugaw Delights API (PHP + MySQL).
// Each context acts as a user through test-only headers the server accepts in test mode.
import { initializeApp } from "../../public/fb/app.js";
import { _testDb } from "../../public/fb/firestore.js";

const API = process.env.LUGAW_API || "http://127.0.0.1:8095/api/index.php";
let n = 0;
const mkDb = headers => _testDb(initializeApp({ apiBase: API }, "test" + (++n)), headers);

export async function initializeTestEnvironment() {
  return {
    authenticatedContext(uid, claims = {}) {
      const provider = claims?.firebase?.sign_in_provider || "password";
      return { firestore: () => mkDb({ "X-Test-Auth": JSON.stringify({ uid, provider, email: claims?.email || "" }) }) };
    },
    unauthenticatedContext() { return { firestore: () => mkDb({}) }; },
    async withSecurityRulesDisabled(fn) { await fn({ firestore: () => mkDb({ "X-Test-Bypass": "1" }) }); },
    async clearFirestore() {
      const r = await fetch(API + "?r=test.clear", { method: "POST", body: "{}" });
      if (!r.ok) throw new Error("clear failed: " + (await r.text()));
    },
    async cleanup() {}
  };
}
export async function assertSucceeds(p) { return await p; }
export async function assertFails(p) {
  try { await p; } catch (e) {
    if (e?.code === "permission-denied") return e;
    throw e;
  }
  throw new Error("Expected request to fail, but it succeeded.");
}
