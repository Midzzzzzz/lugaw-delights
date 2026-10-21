<?php
// The shop's data in PostgreSQL (Render) or MySQL: one row per document (collection + id + JSON), every change numbered
// so screens can ask "what changed since number N?". Every read and write is checked against
// firestore.rules (Rules.php), the same way Firebase checked it.

final class ApiError extends Exception {
  public function __construct(public string $codeName, string $msg = '', public int $http = 400) { parent::__construct($msg ?: $codeName); }
}

final class Store {
  private bool $pg;
  public function __construct(private PDO $db, private Rules $rules, private ?stdClass $auth, private bool $bypass = false) { $this->pg = self::isPg($db); }

  // SQL for a top-level field of the stored JSON: as text, a timestamp's milliseconds, a number, or "is there"
  private function jText(string $f): string { return $this->pg ? "(data::jsonb ->> '$f')" : "JSON_VALUE(data, '$.\"$f\"')"; }
  private function jTs(string $f): string { return $this->pg ? "((data::jsonb -> '$f') ->> '__t')::bigint" : "CAST(JSON_VALUE(data, '$.\"$f\".__t') AS SIGNED)"; }
  private function jNum(string $f): string {
    return $this->pg ? "(CASE WHEN jsonb_typeof(data::jsonb -> '$f') = 'number' THEN (data::jsonb ->> '$f')::numeric END)"
      : "(CASE WHEN JSON_TYPE(JSON_EXTRACT(data, '$.\"$f\"')) IN ('INTEGER', 'DOUBLE', 'DECIMAL') THEN JSON_VALUE(data, '$.\"$f\"') + 0 END)";
  }
  private function jKind(string $f): string { // Firebase's order of value kinds (see kind() below)
    if ($this->pg) { $x = "(data::jsonb -> '$f')";
      return "(CASE jsonb_typeof($x) WHEN 'null' THEN 0 WHEN 'boolean' THEN 1 WHEN 'number' THEN 2 WHEN 'string' THEN 4 WHEN 'array' THEN 6 ELSE (CASE WHEN ($x -> '__t') IS NOT NULL THEN 3 ELSE 7 END) END)"; }
    $x = "JSON_EXTRACT(data, '$.\"$f\"')";
    return "(CASE JSON_TYPE($x) WHEN 'NULL' THEN 0 WHEN 'BOOLEAN' THEN 1 WHEN 'INTEGER' THEN 2 WHEN 'DOUBLE' THEN 2 WHEN 'DECIMAL' THEN 2 WHEN 'STRING' THEN 4 WHEN 'ARRAY' THEN 6 ELSE (CASE WHEN JSON_EXTRACT($x, '$.__t') IS NOT NULL THEN 3 ELSE 7 END) END)";
  }
  private function jHas(string $f): string { return $this->pg ? "(data::jsonb -> '$f') IS NOT NULL" : "JSON_EXTRACT(data, '$.\"$f\"') IS NOT NULL"; }

  public static function isPg(PDO $db): bool { return $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'pgsql'; }
  public static function schema(PDO $db): void {
    if (self::isPg($db)) { // PostgreSQL (Render)
      $db->exec('CREATE TABLE IF NOT EXISTS docs (coll VARCHAR(64) NOT NULL, id VARCHAR(190) COLLATE "C" NOT NULL, data TEXT NOT NULL,
        ver BIGINT NOT NULL, PRIMARY KEY (coll, id))');
      $db->exec('CREATE INDEX IF NOT EXISTS docs_coll_ver ON docs (coll, ver)');
      $db->exec('CREATE TABLE IF NOT EXISTS changes (ver BIGSERIAL PRIMARY KEY, coll VARCHAR(64) NOT NULL)');
      $db->exec('CREATE TABLE IF NOT EXISTS users (uid VARCHAR(40) NOT NULL PRIMARY KEY, email VARCHAR(190) NULL UNIQUE,
        pass VARCHAR(255) NULL, provider VARCHAR(20) NOT NULL, created BIGINT NOT NULL)');
      $db->exec('CREATE TABLE IF NOT EXISTS sessions (token CHAR(64) NOT NULL PRIMARY KEY, uid VARCHAR(40) NOT NULL,
        created BIGINT NOT NULL, seen BIGINT NOT NULL)');
      $db->exec('CREATE INDEX IF NOT EXISTS sessions_uid ON sessions (uid)');
      $db->exec('CREATE TABLE IF NOT EXISTS resets (token CHAR(64) NOT NULL PRIMARY KEY, uid VARCHAR(40) NOT NULL, expires BIGINT NOT NULL)');
      $db->exec('CREATE TABLE IF NOT EXISTS hits (k VARCHAR(190) NOT NULL PRIMARY KEY, n INT NOT NULL, until BIGINT NOT NULL)');
      $db->exec('CREATE TABLE IF NOT EXISTS meta (k VARCHAR(16) NOT NULL PRIMARY KEY, v BIGINT NOT NULL)');
      $db->exec("INSERT INTO meta (k, v) VALUES ('write', 0) ON CONFLICT (k) DO NOTHING");
      self::addUsernames($db);
      return;
    }
    $db->exec("CREATE TABLE IF NOT EXISTS docs (coll VARCHAR(64) NOT NULL, id VARCHAR(190) NOT NULL, data LONGTEXT NOT NULL,
      ver BIGINT NOT NULL, PRIMARY KEY (coll, id), KEY coll_ver (coll, ver)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin");
    $db->exec("CREATE TABLE IF NOT EXISTS changes (ver BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, coll VARCHAR(64) NOT NULL,
      KEY coll (coll)) DEFAULT CHARSET=utf8mb4");
    $db->exec("CREATE TABLE IF NOT EXISTS users (uid VARCHAR(40) NOT NULL PRIMARY KEY, email VARCHAR(190) NULL UNIQUE,
      pass VARCHAR(255) NULL, provider VARCHAR(20) NOT NULL, created BIGINT NOT NULL) DEFAULT CHARSET=utf8mb4");
    $db->exec("CREATE TABLE IF NOT EXISTS sessions (token CHAR(64) NOT NULL PRIMARY KEY, uid VARCHAR(40) NOT NULL,
      created BIGINT NOT NULL, seen BIGINT NOT NULL, KEY uid (uid)) DEFAULT CHARSET=utf8mb4");
    $db->exec("CREATE TABLE IF NOT EXISTS resets (token CHAR(64) NOT NULL PRIMARY KEY, uid VARCHAR(40) NOT NULL,
      expires BIGINT NOT NULL) DEFAULT CHARSET=utf8mb4");
    $db->exec("CREATE TABLE IF NOT EXISTS hits (k VARCHAR(190) NOT NULL PRIMARY KEY, n INT NOT NULL, until BIGINT NOT NULL) DEFAULT CHARSET=utf8mb4");
    $db->exec("CREATE TABLE IF NOT EXISTS meta (k VARCHAR(16) NOT NULL PRIMARY KEY, v BIGINT NOT NULL) DEFAULT CHARSET=utf8mb4");
    $db->exec("INSERT IGNORE INTO meta (k, v) VALUES ('write', 0)");
    self::addUsernames($db);
  }
  // Staff can sign in with a username the owner gives them (added 2026-10-21)
  private static function addUsernames(PDO $db): void {
    $db->exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(40) NULL');
    $db->exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (username)');
  }

  public static function now(): int { return (int)floor(microtime(true) * 1000); }
  private static function okName(string $s): bool { return (bool)preg_match('/^[A-Za-z0-9_\-]{1,64}$/', $s); }
  private static function okId(string $s): bool { return $s !== '' && strlen($s) <= 190 && !str_contains($s, '/') && $s !== '.' && $s !== '..'; }
  public static function split(string $path): array {
    $p = explode('/', trim($path, '/'));
    if (count($p) !== 2 || !self::okName($p[0]) || !self::okId($p[1])) throw new ApiError('invalid-argument', "Bad document path $path");
    return $p;
  }
  public static function decode(string $json) { return json_decode($json, false, 512, JSON_BIGINT_AS_STRING); }
  public static function encode($v): string { return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION); }

  private function row(string $coll, string $id, bool $lock = false): ?array {
    $q = $this->db->prepare('SELECT data, ver FROM docs WHERE coll = ? AND id = ?' . ($lock ? ' FOR UPDATE' : ''));
    $q->execute([$coll, $id]); $r = $q->fetch(PDO::FETCH_ASSOC);
    return $r ? ['data' => self::decode($r['data']), 'ver' => (int)$r['ver']] : null;
  }
  private function check(string $method, string $coll, string $id, ?stdClass $old, ?stdClass $new, int $time): void {
    if ($this->bypass) return;
    $ok = $this->rules->allowed($method, $coll, $id, ['auth' => $this->auth, 'time' => $time, 'resource' => $old, 'newData' => $new]);
    if (!$ok) throw new ApiError('permission-denied', 'Missing or insufficient permissions.', 403);
  }

  // ---------- reading ----------
  public function get(string $path): array {
    [$coll, $id] = self::split($path);
    $this->rules->getDoc = fn($c, $i) => $this->row($c, $i)['data'] ?? null;
    $r = $this->row($coll, $id);
    $this->check('get', $coll, $id, $r['data'] ?? null, null, self::now());
    return $r ? ['exists' => true, 'data' => $r['data'], 'ver' => $r['ver']] : ['exists' => false, 'ver' => 0];
  }

  // $q: {coll, where: [[field, op, value]...], order: [[field, dir]...], limit}
  public function query(stdClass $q): array {
    $coll = (string)($q->coll ?? '');
    if (!self::okName($coll)) throw new ApiError('invalid-argument', 'Bad collection');
    $where = $q->where ?? []; $order = $q->order ?? []; $limit = isset($q->limit) ? max(0, (int)$q->limit) : null;
    $sql = 'SELECT id, data, ver FROM docs WHERE coll = ?'; $args = [$coll]; $exact = true;
    foreach ($where as [$f, $op, $v]) {
      if (!preg_match('/^[A-Za-z0-9_]+$/', (string)$f)) throw new ApiError('invalid-argument', 'Bad field');
      if ($op === '==' && is_string($v)) { $sql .= " AND {$this->jText($f)} = ?"; $args[] = $v; }
      elseif ($op === 'in' && is_array($v) && $v && count(array_filter($v, 'is_string')) === count($v)) {
        $sql .= " AND {$this->jText($f)} IN (" . implode(',', array_fill(0, count($v), '?')) . ')'; array_push($args, ...$v); }
      elseif (in_array($op, ['<', '<=', '>', '>='], true) && Rules::isTs($v)) {
        $sql .= " AND {$this->jTs($f)} $op ?"; $args[] = $v->__t; }
      else $exact = false;
    }
    if ($order && $exact && $limit !== null && count($order) === 1) {
      [$f, $dir] = $order[0]; $dir = $dir === 'desc' ? 'DESC' : 'ASC';
      if (preg_match('/^[A-Za-z0-9_]+$/', (string)$f)) {
        // the database picks the first N; PHP below sorts them exactly as Firebase does
        $str = $this->pg ? "{$this->jText($f)} COLLATE \"C\"" : $this->jText($f);
        $sql .= " AND {$this->jHas($f)} ORDER BY {$this->jKind($f)} $dir, {$this->jNum($f)} $dir, {$this->jTs($f)} $dir, $str $dir, id LIMIT " . ($limit + 0);
      }
    }
    $st = $this->db->prepare($sql); $st->execute($args);
    $rows = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
      $d = self::decode($r['data']);
      if (!$this->matches($d, $where)) continue;
      $rows[] = ['id' => $r['id'], 'data' => $d, 'ver' => (int)$r['ver']];
    }
    if ($order) {
      foreach ($order as [$f]) $rows = array_values(array_filter($rows, fn($r) => property_exists($r['data'], $f)));
      usort($rows, function ($a, $b) use ($order) {
        foreach ($order as [$f, $dir]) { $c = self::cmpVal($a['data']->$f, $b['data']->$f); if ($c) return $dir === 'desc' ? -$c : $c; }
        return strcmp($a['id'], $b['id']);
      });
    } else usort($rows, fn($a, $b) => strcmp($a['id'], $b['id']));
    if ($limit !== null) $rows = array_slice($rows, 0, $limit);
    if (!$this->bypass) {
      $this->rules->getDoc = fn($c, $i) => $this->row($c, $i)['data'] ?? null;
      $t = self::now();
      foreach ($rows as $r) $this->check('list', $coll, $r['id'], $r['data'], null, $t);
    }
    return $rows;
  }
  private function matches(stdClass $d, array $where): bool {
    foreach ($where as [$f, $op, $v]) {
      if (!property_exists($d, $f)) return false;
      $x = $d->$f;
      switch ($op) {
        case '==': if (!$this->rules->eq($x, $v)) return false; break;
        case '!=': if ($this->rules->eq($x, $v) || $x === null) return false; break;
        case 'in': $hit = false; foreach ($v as $y) if ($this->rules->eq($x, $y)) $hit = true; if (!$hit) return false; break;
        case 'not-in': foreach ($v as $y) if ($this->rules->eq($x, $y)) return false; break;
        case 'array-contains': if (!is_array($x)) return false; $hit = false; foreach ($x as $y) if ($this->rules->eq($y, $v)) $hit = true; if (!$hit) return false; break;
        case '<': case '<=': case '>': case '>=':
          if (self::kind($x) !== self::kind($v)) return false;
          $c = self::cmpVal($x, $v);
          if (!match ($op) { '<' => $c < 0, '<=' => $c <= 0, '>' => $c > 0, '>=' => $c >= 0 }) return false; break;
        default: throw new ApiError('invalid-argument', "Unsupported filter $op");
      }
    }
    return true;
  }
  private static function kind($v): int { // Firestore's ordering of types
    if ($v === null) return 0; if (is_bool($v)) return 1; if (is_int($v) || is_float($v)) return 2;
    if (Rules::isTs($v)) return 3; if (is_string($v)) return 4; if (is_array($v)) return 6; return 7;
  }
  public static function cmpVal($a, $b): int {
    $ka = self::kind($a); $kb = self::kind($b); if ($ka !== $kb) return $ka <=> $kb;
    if ($ka === 3) return $a->__t <=> $b->__t;
    if ($ka === 4) return strcmp($a, $b) <=> 0;
    if ($ka === 6 || $ka === 7) return strcmp(self::encode($a), self::encode($b)) <=> 0;
    return $a <=> $b;
  }

  // ---------- writing: a batch of set / update / delete, all or nothing ----------
  // write: {op: set|update|delete, path, data, merge, ifVer}  (ifVer: transactions; 0 = must not exist)
  public function commit(array $writes): int {
    if (count($writes) > 500) throw new ApiError('invalid-argument', 'Too many writes in one batch');
    $time = self::now();
    $this->db->beginTransaction();
    try {
      // one save at a time, so change numbers are finished in order (live updates never skip one)
      $this->db->query("SELECT v FROM meta WHERE k = 'write' FOR UPDATE");
      $before = []; $after = []; $plan = [];
      foreach ($writes as $w) {
        [$coll, $id] = self::split((string)$w->path); $key = "$coll/$id";
        if (!array_key_exists($key, $before)) { $r = $this->row($coll, $id, true); $before[$key] = $r; $after[$key] = $r['data'] ?? null; }
        if (property_exists($w, 'ifVer') && $w->ifVer !== null && (int)$w->ifVer !== (int)($before[$key]['ver'] ?? 0))
          throw new ApiError('aborted', 'The document changed. Please try again.', 409);
        $cur = $after[$key];
        switch ($w->op) {
          case 'delete': $new = null; break;
          case 'update':
            if ($cur === null) { // like Firebase: the rules decide first (usually "denied"), then "not found"
              if (!$this->bypass) {
                $this->rules->getDoc = fn($c, $i) => $this->row($c, $i)['data'] ?? null;
                $this->check('update', $coll, $id, null, $this->apply(new stdClass, $w->data, false, $time), $time);
              }
              throw new ApiError('not-found', "No document to update: $key", 404);
            }
            $new = $this->apply(clone $cur, $w->data, false, $time); break;
          case 'set':
            $new = !empty($w->merge) && $cur !== null ? $this->apply(self::decode(self::encode($cur)), $w->data, true, $time) : $this->apply(new stdClass, $w->data, true, $time); break;
          default: throw new ApiError('invalid-argument', 'Bad write op');
        }
        $after[$key] = $new; $plan[$key] = [$coll, $id];
      }
      if (!$this->bypass) {
        $this->rules->getDoc = function ($c, $i, $isAfter) use ($before, $after) {
          $k = "$c/$i";
          if ($isAfter && array_key_exists($k, $after)) return $after[$k];
          if (!$isAfter && array_key_exists($k, $before)) return $before[$k]['data'] ?? null;
          return $this->row($c, $i)['data'] ?? null;
        };
        foreach ($plan as $key => [$coll, $id]) {
          $old = $before[$key]['data'] ?? null; $new = $after[$key];
          $method = $new === null ? 'delete' : ($old === null ? 'create' : 'update');
          if ($new === null && $old === null) $method = 'delete';
          $this->check($method, $coll, $id, $old, $new, $time);
        }
      }
      $ver = 0;
      foreach ($plan as $key => [$coll, $id]) {
        if ($this->pg) { $q = $this->db->prepare('INSERT INTO changes (coll) VALUES (?) RETURNING ver'); $q->execute([$coll]); $ver = (int)$q->fetchColumn(); }
        else { $this->db->prepare('INSERT INTO changes (coll) VALUES (?)')->execute([$coll]); $ver = (int)$this->db->lastInsertId(); }
        if ($after[$key] === null) $this->db->prepare('DELETE FROM docs WHERE coll = ? AND id = ?')->execute([$coll, $id]);
        else $this->db->prepare('INSERT INTO docs (coll, id, data, ver) VALUES (?, ?, ?, ?) ' . ($this->pg
            ? 'ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, ver = EXCLUDED.ver'
            : 'ON DUPLICATE KEY UPDATE data = VALUES(data), ver = VALUES(ver)'))
          ->execute([$coll, $id, self::encode($after[$key]), $ver]);
      }
      $this->db->commit();
      if ($ver && $ver % 500 === 0) $this->db->exec('DELETE FROM changes WHERE ver < ' . ($ver - 20000)); // keep the change list short
      return $ver;
    } catch (Throwable $e) { $this->db->rollBack(); throw $e; }
  }
  // Merges the written fields into a document, resolving server timestamps and field transforms
  private function apply(stdClass $doc, $data, bool $deep, int $time): stdClass {
    if (!$data instanceof stdClass) throw new ApiError('invalid-argument', 'Document data must be a map');
    foreach ((array)$data as $k => $v) {
      if ($v instanceof stdClass && property_exists($v, '__op')) {
        switch ($v->__op) {
          case 'del': unset($doc->$k); break;
          case 'union': $arr = (isset($doc->$k) && is_array($doc->$k)) ? $doc->$k : [];
            foreach ($this->resolve($v->v, $time) as $x) { $has = false; foreach ($arr as $y) if ($this->rules->eq($x, $y)) $has = true; if (!$has) $arr[] = $x; }
            $doc->$k = $arr; break;
          case 'remove': $arr = (isset($doc->$k) && is_array($doc->$k)) ? $doc->$k : [];
            $doc->$k = array_values(array_filter($arr, function ($y) use ($v, $time) { foreach ($this->resolve($v->v, $time) as $x) if ($this->rules->eq($x, $y)) return false; return true; })); break;
          case 'inc': $cur = (isset($doc->$k) && (is_int($doc->$k) || is_float($doc->$k))) ? $doc->$k : 0; $doc->$k = $cur + $v->v; break;
          default: throw new ApiError('invalid-argument', 'Unknown field transform');
        }
        continue;
      }
      if ($deep && Rules::isMap($v) && !property_exists($v, '__st') && isset($doc->$k) && Rules::isMap($doc->$k)) { $doc->$k = $this->apply($doc->$k, $v, true, $time); continue; }
      $doc->$k = $this->resolve($v, $time);
    }
    return $doc;
  }
  private function resolve($v, int $time) {
    if ($v instanceof stdClass) {
      if (property_exists($v, '__st')) return Rules::ts($time);
      if (Rules::isTs($v)) return $v;
      $o = new stdClass; foreach ((array)$v as $k => $x) $o->$k = $this->resolve($x, $time); return $o;
    }
    if (is_array($v)) return array_map(fn($x) => $this->resolve($x, $time), $v);
    return $v;
  }

  // ---------- live updates: what changed since version N ----------
  public function version(): int { return (int)$this->db->query('SELECT COALESCE(MAX(ver), 0) FROM changes')->fetchColumn(); }
  public function changedSince(int $since): ?array { // null = too old to tell: send everything
    $min = (int)$this->db->query('SELECT COALESCE(MIN(ver), 0) FROM changes')->fetchColumn();
    if ($since < $min - 1) return null;
    $q = $this->db->prepare('SELECT DISTINCT coll FROM changes WHERE ver > ?'); $q->execute([$since]);
    return $q->fetchAll(PDO::FETCH_COLUMN);
  }
}
