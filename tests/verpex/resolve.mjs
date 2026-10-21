const map = { "firebase/firestore": new URL("./firestore.mjs", import.meta.url).href,
  "@firebase/rules-unit-testing": new URL("./rules-unit-testing.mjs", import.meta.url).href };
export async function resolve(spec, ctx, next) { return map[spec] ? { url: map[spec], shortCircuit: true } : next(spec, ctx); }
