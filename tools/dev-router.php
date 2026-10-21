<?php
// Local testing on this computer (pages + API on one address):
//   php -S 127.0.0.1:8095 -t public tools/dev-router.php
// With LUGAW_TESTDIR set, /__test/<page>.html?drv=<file>.js serves the real page with a test script
// from that folder added (automated browser tests); /__test/<file> serves the file itself.
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($p, '/api/') || $p === '/api') { chdir(__DIR__ . '/../server'); require __DIR__ . '/../server/index.php'; return true; }
$dir = getenv('LUGAW_TESTDIR');
if ($dir && str_starts_with($p, '/__test/')) {
  $name = basename($p);
  $page = __DIR__ . '/../public/' . $name;
  if (str_ends_with($name, '.html') && is_file($page)) {
    $drv = basename($_GET['drv'] ?? '');
    $html = file_get_contents($page);
    $html = preg_replace('/<head>/', '<head><base href="/"><script>window.__errs=[];addEventListener("error",e=>__errs.push(String(e.message)+" "+(e.filename||"")+":"+e.lineno),true);addEventListener("unhandledrejection",e=>__errs.push("rej "+(e.reason&&(e.reason.stack||e.reason.message)||e.reason)));</script>', $html, 1);
    if ($drv) $html = preg_replace('#</body>(?![\s\S]*</body>)#', '<script type="module" src="/__test/' . $drv . '"></script></body>', $html);
    header('Content-Type: text/html; charset=utf-8'); echo $html; return true;
  }
  $f = $dir . '/' . $name;
  if (is_file($f)) { header('Content-Type: ' . (str_ends_with($f, '.js') ? 'text/javascript' : 'text/plain')); readfile($f); return true; }
  http_response_code(404); return true;
}
return false;
