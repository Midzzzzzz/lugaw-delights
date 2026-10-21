// Runs every tests/*.test.mjs against the Lugaw Delights API on this computer (PHP + MySQL):
//   node tests/verpex/run-all.mjs [name-filter]
// Starts a PHP server in test mode on port 8095 (database lugaw_test) and stops it afterwards.
import { readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const tests = fileURLToPath(new URL("..", import.meta.url));
const php = process.env.PHP || "C:/xampp/php/php.exe";
const filter = process.argv[2] || "";
const server = spawn(php, ["-S", "127.0.0.1:8095", "-t", "public", "tools/dev-router.php"], { cwd: root, env: { ...process.env, LUGAW_TEST: "1", LUGAW_DB: "lugaw_test" }, stdio: "ignore" });
await new Promise(r => setTimeout(r, 1200));
const files = readdirSync(tests).filter(f => f.endsWith(".test.mjs") && f.includes(filter)).sort();
let failed = 0;
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, ["--import", "./verpex/hooks.mjs", f], { cwd: tests, stdio: "inherit" });
  if (r.status !== 0) failed++;
}
server.kill();
console.log(`\n${files.length - failed} of ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
