<?php
// Lugaw Delights API (replaces Firebase). Every call is POST index.php?r=<name> with a JSON body;
// the signed-in user's token comes in the X-Lugaw-Token header.
declare(strict_types=1);
require __DIR__ . '/lib/Rules.php';
require __DIR__ . '/lib/Store.php';
require __DIR__ . '/lib/Auth.php';

// Settings: lugaw-config.php above the website folder (keeps the database password out of reach),
// or config.php here (protected by .htaccess), or the LUGAW_CONFIG environment variable.
$cfgFile = getenv('LUGAW_CONFIG') ?: (is_file(__DIR__ . '/../../lugaw-config.php') ? __DIR__ . '/../../lugaw-config.php' : __DIR__ . '/config.php');
$cfg = is_file($cfgFile) ? require $cfgFile : [];
// On Render the settings come from environment variables (see render.yaml)
if ($url = getenv('DATABASE_URL')) {
  $u = parse_url($url);
  $cfg['db'] = ['dsn' => sprintf('pgsql:host=%s;port=%d;dbname=%s', $u['host'], $u['port'] ?? 5432, ltrim($u['path'], '/')),
    'user' => urldecode($u['user'] ?? ''), 'pass' => urldecode($u['pass'] ?? '')];
}
foreach (['SITE_URL' => 'site_url', 'MAIL_FROM' => 'mail_from', 'RESEND_API_KEY' => 'resend_key'] as $env => $key) if (getenv($env)) $cfg[$key] = getenv($env);
if (getenv('BEHIND_PROXY')) $cfg['behind_proxy'] = true;
if (getenv('ORIGINS')) $cfg['origins'] = array_map('trim', explode(',', getenv('ORIGINS')));

// Who may call the API from another address: the apps (Capacitor) and the site itself
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = array_merge(['https://localhost', 'http://localhost', 'capacitor://localhost'], $cfg['origins'] ?? []);
if ($origin && (in_array($origin, $allowed, true) || !empty($cfg['test_mode']))) {
  header("Access-Control-Allow-Origin: $origin");
  header('Vary: Origin');
  header('Access-Control-Allow-Headers: Content-Type, X-Lugaw-Token, X-Test-Auth, X-Test-Bypass');
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Max-Age: 86400');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function reply($data, int $code = 200): never { http_response_code($code); echo Store::encode($data); exit; }

try {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') reply(['ok' => true, 'service' => 'Lugaw Delights API']);
  if (empty($cfg['db'])) throw new ApiError('failed-precondition', 'The server isn\'t set up yet (no database settings).', 500);
  $isMy = str_starts_with($cfg['db']['dsn'], 'mysql:');
  $db = new PDO($cfg['db']['dsn'], $cfg['db']['user'], $cfg['db']['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    + ($isMy ? [PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4, time_zone = '+00:00'"] : []));
  $raw = file_get_contents('php://input');
  if (strlen($raw) > 6_000_000) throw new ApiError('invalid-argument', 'Request too large', 413);
  $in = $raw === '' ? new stdClass : Store::decode($raw);
  if (!$in instanceof stdClass) throw new ApiError('invalid-argument', 'Bad request body');
  $r = (string)($_GET['r'] ?? '');

  // First call on a new server creates the tables
  if (!is_file(__DIR__ . '/.schema-ok') || !empty($cfg['test_mode'])) { Store::schema($db); @file_put_contents(__DIR__ . '/.schema-ok', '1'); }

  // One-time copy of the shop's data from Firebase (2026-10). Opens only with the key whose
  // SHA-256 is below; adds or replaces documents, adds accounts that aren't there yet.
  if ($r === 'admin.import') {
    if (!hash_equals('9dfac8d92310cfac6197caa4278e27ddacf85062d1401afac02456d03268cccf', hash('sha256', (string)($_SERVER['HTTP_X_IMPORT_KEY'] ?? ''))))
      throw new ApiError('permission-denied', 'Missing or insufficient permissions.', 403);
    reply(Store::import($db, (array)($in->docs ?? []), (array)($in->users ?? [])));
  }

  $auth = new Auth($db, $cfg);
  $token = $_SERVER['HTTP_X_LUGAW_TOKEN'] ?? null;
  $user = $auth->user($token);
  $bypass = false;

  // Test mode only (never on the live server): the automated tests act as any user
  $isLocal = in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
  if (!empty($cfg['test_mode']) && $isLocal) {
    if (!empty($_SERVER['HTTP_X_TEST_AUTH'])) { $t = json_decode($_SERVER['HTTP_X_TEST_AUTH'], true); $user = ['uid' => $t['uid'], 'email' => $t['email'] ?? '', 'provider' => $t['provider'] ?? 'password']; }
    if (!empty($_SERVER['HTTP_X_TEST_BYPASS'])) $bypass = true;
    if ($r === 'test.clear') { foreach (['docs', 'changes', 'users', 'sessions', 'resets', 'hits'] as $t) $db->exec("DELETE FROM $t"); reply(['ok' => true]); }
  }

  $rulesFile = $cfg['rules'] ?? __DIR__ . '/firestore.rules';
  $rules = new Rules(file_get_contents($rulesFile));
  $store = new Store($db, $rules, Auth::ruleAuth($user), $bypass);

  switch ($r) {
    case 'auth.signup': reply($auth->signup($in->email ?? '', $in->password ?? ''));
    case 'auth.login': reply($auth->login($in->email ?? '', $in->password ?? ''));
    case 'auth.anon': reply($auth->anonymous());
    case 'auth.me': reply(['user' => $auth->me($token)]);
    case 'auth.logout': $auth->logout($token); reply(['ok' => true]);
    case 'auth.reauth': $auth->reauth($token, $in->password ?? ''); reply(['ok' => true]);
    case 'auth.reset': $auth->sendReset($in->email ?? ''); reply(['ok' => true]);
    case 'auth.setLogin': $auth->setLoginFor($token, $in->uid ?? '', $in->username ?? null, $in->password ?? null); reply(['ok' => true]);
    case 'auth.usernames': reply(['usernames' => (object)$auth->usernames($token)]);
    case 'auth.resetDone': $auth->finishReset($in->token ?? '', $in->password ?? ''); reply(['ok' => true]);

    case 'get': reply($store->get((string)($in->path ?? '')));
    case 'query': reply(['docs' => $store->query($in->q ?? new stdClass)]);
    case 'commit': reply(['ver' => $store->commit((array)($in->writes ?? []))]);

    // Live updates. listens: [{k, doc: path} | {k, q: query}]; known: keys the page already has.
    // Only what changed since "since" is sent back: changed documents in full, and each query's ids.
    case 'poll':
      $since = (int)($in->since ?? 0); $ver = $store->version();
      $changed = $since > 0 ? $store->changedSince($since) : null;
      $roles = ['admins', 'sellers', 'kitchen', 'riders', 'agreements'];
      $all = $changed === null || array_intersect($roles, $changed);
      $known = array_flip(array_map('strval', (array)($in->known ?? [])));
      $out = [];
      foreach ((array)($in->listens ?? []) as $l) {
        $k = (string)$l->k; $isKnown = isset($known[$k]);
        $coll = isset($l->doc) ? explode('/', trim((string)$l->doc, '/'))[0] : (string)($l->q->coll ?? '');
        if ($isKnown && !$all && !in_array($coll, $changed, true)) continue;
        try {
          if (isset($l->doc)) {
            $d = $store->get((string)$l->doc);
            if ($isKnown && $d['ver'] <= $since && $d['exists']) continue;
            $out[$k] = $d;
          } else {
            $rows = $store->query($l->q);
            $docs = new stdClass;
            foreach ($rows as $row) if (!$isKnown || $row['ver'] > $since || $all) $docs->{$row['id']} = $row['data'];
            $out[$k] = ['ids' => array_column($rows, 'id'), 'docs' => $docs];
          }
        } catch (ApiError $e) { $out[$k] = ['error' => $e->codeName, 'message' => $e->getMessage()]; }
      }
      reply(['ver' => $ver, 'res' => (object)$out]);
  }
  throw new ApiError('not-found', 'Unknown request', 404);
} catch (ApiError $e) {
  reply(['error' => ['code' => $e->codeName, 'message' => $e->getMessage()]], $e->http);
} catch (Throwable $e) {
  error_log('Lugaw API: ' . $e);
  reply(['error' => ['code' => 'internal', 'message' => !empty($cfg['test_mode']) ? (string)$e : 'Something went wrong on the server.']], 500);
}
