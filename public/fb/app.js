// initializeApp: same call as Firebase's. options.apiBase: the API's full address (the apps set it;
// the website uses its own api/ folder). Each name (customer, seller, rider…) keeps its own sign-in.
const apps = new Map();
export function initializeApp(options = {}, name = "[DEFAULT]") {
  if (!apps.has(name)) apps.set(name, { name, options });
  return apps.get(name);
}
export function getApp(name = "[DEFAULT]") { return apps.get(name); }
