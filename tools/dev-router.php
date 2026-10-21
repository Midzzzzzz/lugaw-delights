<?php
// php -S 127.0.0.1:8095 -t public tools/dev-router.php   (local testing: pages + API on one address)
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($p, '/api/') || $p === '/api') { chdir(__DIR__ . '/../server'); require __DIR__ . '/../server/index.php'; return true; }
return false;
