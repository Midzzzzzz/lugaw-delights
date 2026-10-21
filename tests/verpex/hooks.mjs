// Run a test file against the PHP server: node --import ./verpex/hooks.mjs file.test.mjs
import { register } from "node:module";
register("./resolve.mjs", import.meta.url);
