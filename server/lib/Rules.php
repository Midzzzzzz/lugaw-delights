<?php
// Reads firestore.rules and decides, exactly as Firebase did, whether a read or write is allowed.
// The rules file stays the one place the shop's security is written down.
//
// Values while evaluating:
//   maps: stdClass, lists: PHP arrays, timestamps: stdClass with only "__t" (milliseconds),
//   durations: RDur, paths: RPath, map diffs: RDiff, null/bool/int/float/string as is.
// A failed lookup (missing field, wrong type...) raises RErr; like Firebase, "a || b" and
// "a && b" can still decide when one side fails, and a failed rule denies.

final class RErr extends Exception {}
final class RDur { public function __construct(public int $ms) {} }
final class RPath { public function __construct(public string $p) {} }
final class RDiff { public function __construct(public stdClass $a, public stdClass $b) {} }

final class Rules {
  private array $toks = []; private int $i = 0;
  public array $root;            // parsed: ['matches' => [...]]
  public $getDoc;                // fn(string $coll, string $id, bool $after): ?stdClass  (document data)
  private array $cache = [];

  public function __construct(string $src) { $this->toks = self::lex($src); $this->i = 0; $this->root = $this->parseFile(); }

  // ---------- lexer ----------
  private static function lex(string $s): array {
    $t = []; $n = strlen($s); $i = 0;
    while ($i < $n) {
      $c = $s[$i];
      if (ctype_space($c)) { $i++; continue; }
      if ($c === '/' && ($s[$i + 1] ?? '') === '/') { while ($i < $n && $s[$i] !== "\n") $i++; continue; }
      if ($c === '/' && ($s[$i + 1] ?? '') === '*') { $e = strpos($s, '*/', $i + 2); $i = $e === false ? $n : $e + 2; continue; }
      if (ctype_alpha($c) || $c === '_') { $j = $i; while ($j < $n && (ctype_alnum($s[$j]) || $s[$j] === '_')) $j++; $t[] = ['id', substr($s, $i, $j - $i)]; $i = $j; continue; }
      if (ctype_digit($c)) { $j = $i; while ($j < $n && ctype_digit($s[$j])) $j++;
        if (($s[$j] ?? '') === '.' && ctype_digit($s[$j + 1] ?? '')) { $j++; while ($j < $n && ctype_digit($s[$j])) $j++; $t[] = ['num', (float)substr($s, $i, $j - $i)]; }
        else $t[] = ['num', (int)substr($s, $i, $j - $i)];
        $i = $j; continue; }
      if ($c === "'" || $c === '"') { $j = $i + 1; $v = '';
        while ($j < $n && $s[$j] !== $c) { if ($s[$j] === '\\') { $j++; $e = $s[$j] ?? ''; $v .= ['n' => "\n", 't' => "\t"][$e] ?? $e; } else $v .= $s[$j]; $j++; }
        $t[] = ['str', $v]; $i = $j + 1; continue; }
      $two = substr($s, $i, 2);
      if (in_array($two, ['&&', '||', '==', '!=', '<=', '>='], true)) { $t[] = ['op', $two]; $i += 2; continue; }
      $t[] = ['op', $c]; $i++;
    }
    $t[] = ['eof', null];
    return $t;
  }
  private function peek(int $k = 0) { return $this->toks[$this->i + $k]; }
  private function next() { return $this->toks[$this->i++]; }
  private function is(string $type, $v = null, int $k = 0): bool { $t = $this->peek($k); return $t[0] === $type && ($v === null || $t[1] === $v); }
  private function expect(string $type, $v = null) {
    $t = $this->next();
    if ($t[0] !== $type || ($v !== null && $t[1] !== $v)) throw new Exception("Rules parse error: expected $type " . ($v ?? '') . ", got {$t[0]} " . json_encode($t[1]) . " at token {$this->i}");
    return $t[1];
  }

  // ---------- parser: file, match blocks, functions, allows ----------
  private function parseFile(): array {
    $blk = ['matches' => [], 'funcs' => [], 'allows' => []];
    while (!$this->is('eof')) {
      if ($this->is('id', 'rules_version')) { $this->next(); $this->expect('op', '='); $this->next(); if ($this->is('op', ';')) $this->next(); continue; }
      if ($this->is('id', 'service')) { $this->next(); while (!$this->is('op', '{')) $this->next(); $this->next(); $this->parseBody($blk); $this->expect('op', '}'); continue; }
      throw new Exception('Rules parse error near token ' . json_encode($this->peek()));
    }
    return $blk;
  }
  private function parseBody(array &$blk): void {
    while (!$this->is('op', '}') && !$this->is('eof')) {
      if ($this->is('id', 'match')) { $this->next(); $blk['matches'][] = $this->parseMatch(); }
      elseif ($this->is('id', 'function')) { $this->next(); $f = $this->parseFunc(); $blk['funcs'][$f['name']] = $f; }
      elseif ($this->is('id', 'allow')) { $this->next(); $blk['allows'][] = $this->parseAllow(); }
      else throw new Exception('Rules parse error near ' . json_encode($this->peek()));
    }
  }
  private function parseMatch(): array {
    $segs = [];
    while ($this->is('op', '/')) {
      $this->next();
      if ($this->is('op', '{')) { $this->next(); $name = $this->expect('id'); $wild = false;
        if ($this->is('op', '=')) { $this->next(); $this->expect('op', '*'); $this->expect('op', '*'); $wild = true; }
        $this->expect('op', '}'); $segs[] = ['var', $name, $wild]; }
      else $segs[] = ['lit', $this->expect('id')];
    }
    $this->expect('op', '{');
    $blk = ['segs' => $segs, 'matches' => [], 'funcs' => [], 'allows' => []];
    $this->parseBody($blk);
    $this->expect('op', '}');
    return $blk;
  }
  private function parseFunc(): array {
    $name = $this->expect('id'); $this->expect('op', '('); $params = [];
    while (!$this->is('op', ')')) { $params[] = $this->expect('id'); if ($this->is('op', ',')) $this->next(); }
    $this->expect('op', ')'); $this->expect('op', '{'); $lets = [];
    while ($this->is('id', 'let')) { $this->next(); $n = $this->expect('id'); $this->expect('op', '='); $lets[] = [$n, $this->expr()]; $this->expect('op', ';'); }
    $this->expect('id', 'return'); $body = $this->expr(); if ($this->is('op', ';')) $this->next(); $this->expect('op', '}');
    return ['name' => $name, 'params' => $params, 'lets' => $lets, 'body' => $body];
  }
  private function parseAllow(): array {
    $methods = [$this->expect('id')];
    while ($this->is('op', ',')) { $this->next(); $methods[] = $this->expect('id'); }
    $cond = ['lit', true];
    if ($this->is('op', ':')) { $this->next(); $this->expect('id', 'if'); $cond = $this->expr(); }
    $this->expect('op', ';');
    return ['methods' => $methods, 'cond' => $cond];
  }

  // ---------- expressions (precedence: ?: < || < && < ==,!=,<,in,is < + - < * / % < unary < postfix) ----------
  private function expr(): array {
    $c = $this->orE();
    if ($this->is('op', '?')) { $this->next(); $a = $this->expr(); $this->expect('op', ':'); $b = $this->expr(); return ['?', $c, $a, $b]; }
    return $c;
  }
  private function orE(): array { $l = $this->andE(); while ($this->is('op', '||')) { $this->next(); $l = ['||', $l, $this->andE()]; } return $l; }
  private function andE(): array { $l = $this->cmpE(); while ($this->is('op', '&&')) { $this->next(); $l = ['&&', $l, $this->cmpE()]; } return $l; }
  private function cmpE(): array {
    $l = $this->addE();
    while (true) {
      if ($this->is('op') && in_array($this->peek()[1], ['==', '!=', '<', '<=', '>', '>='], true)) { $op = $this->next()[1]; $l = ['cmp', $op, $l, $this->addE()]; }
      elseif ($this->is('id', 'in')) { $this->next(); $l = ['in', $l, $this->addE()]; }
      elseif ($this->is('id', 'is')) { $this->next(); $l = ['is', $l, $this->expect('id')]; }
      else return $l;
    }
  }
  private function addE(): array { $l = $this->mulE(); while ($this->is('op', '+') || $this->is('op', '-')) { $op = $this->next()[1]; $l = ['arith', $op, $l, $this->mulE()]; } return $l; }
  private function mulE(): array { $l = $this->unE(); while ($this->is('op', '*') || $this->is('op', '%')) { $op = $this->next()[1]; $l = ['arith', $op, $l, $this->unE()]; } return $l; }
  private function unE(): array {
    if ($this->is('op', '!')) { $this->next(); return ['!', $this->unE()]; }
    if ($this->is('op', '-')) { $this->next(); return ['neg', $this->unE()]; }
    return $this->postE();
  }
  private function postE(): array {
    $e = $this->primE();
    while (true) {
      if ($this->is('op', '.')) { $this->next(); $name = $this->expect('id');
        if ($this->is('op', '(')) $e = ['call', $e, $name, $this->args()]; else $e = ['field', $e, $name]; }
      elseif ($this->is('op', '[')) { $this->next(); $k = $this->expr(); $this->expect('op', ']'); $e = ['index', $e, $k]; }
      else return $e;
    }
  }
  private function args(): array { $this->expect('op', '('); $a = []; while (!$this->is('op', ')')) { $a[] = $this->expr(); if ($this->is('op', ',')) $this->next(); } $this->expect('op', ')'); return $a; }
  private function primE(): array {
    $t = $this->peek();
    if ($t[0] === 'num' || $t[0] === 'str') { $this->next(); return ['lit', $t[1]]; }
    if ($t[0] === 'op' && $t[1] === '(') { $this->next(); $e = $this->expr(); $this->expect('op', ')'); return $e; }
    if ($t[0] === 'op' && $t[1] === '[') { $this->next(); $a = []; while (!$this->is('op', ']')) { $a[] = $this->expr(); if ($this->is('op', ',')) $this->next(); } $this->next(); return ['list', $a]; }
    if ($t[0] === 'op' && $t[1] === '{') { $this->next(); $kv = [];
      while (!$this->is('op', '}')) { $k = $this->next()[1]; $this->expect('op', ':'); $kv[] = [$k, $this->expr()]; if ($this->is('op', ',')) $this->next(); }
      $this->next(); return ['map', $kv]; }
    if ($t[0] === 'op' && $t[1] === '/') { // path literal: /databases/$(database)/documents/coll/$(id)
      $parts = [];
      while ($this->is('op', '/')) { $this->next();
        if ($this->is('op', '$')) { $this->next(); $this->expect('op', '('); $parts[] = ['e', $this->expr()]; $this->expect('op', ')'); }
        else $parts[] = ['s', (string)$this->next()[1]]; }
      return ['path', $parts];
    }
    if ($t[0] === 'id') {
      $this->next();
      if ($t[1] === 'true') return ['lit', true];
      if ($t[1] === 'false') return ['lit', false];
      if ($t[1] === 'null') return ['lit', null];
      if ($this->is('op', '(')) return ['fn', $t[1], $this->args()];
      return ['var', $t[1]];
    }
    throw new Exception('Rules parse error near ' . json_encode($t));
  }

  // ---------- deciding a request ----------
  // $method: get | list | create | update | delete. $path: [coll, id].
  // $ctx: ['auth' => ?stdClass, 'time' => ms, 'resource' => ?stdClass data, 'newData' => ?stdClass data]
  public function allowed(string $method, string $coll, string $id, array $ctx): bool {
    $segs = ['databases', '(default)', 'documents', $coll, $id];
    $this->cache = [];
    $now = self::ts($ctx['time']);
    $request = (object)['auth' => $ctx['auth'], 'time' => $now, 'method' => $method,
      'path' => new RPath("/databases/(default)/documents/$coll/$id"),
      'resource' => $ctx['newData'] === null ? null : (object)['data' => $ctx['newData'], 'id' => $id, '__name__' => new RPath("/databases/(default)/documents/$coll/$id")]];
    $resource = $ctx['resource'] === null ? null : (object)['data' => $ctx['resource'], 'id' => $id, '__name__' => new RPath("/databases/(default)/documents/$coll/$id")];
    $kind = in_array($method, ['get', 'list'], true) ? 'read' : 'write';
    return $this->walk($this->root, $segs, 0, ['request' => $request, 'resource' => $resource], [], $method, $kind);
  }
  private function walk(array $blk, array $segs, int $pos, array $vars, array $funcs, string $method, string $kind): bool {
    $funcs = array_merge($funcs, $blk['funcs']);
    if ($pos === count($segs)) {
      foreach ($blk['allows'] as $a) {
        if (!in_array($method, $a['methods'], true) && !in_array($kind, $a['methods'], true)) continue;
        try { if ($this->truthy($this->ev($a['cond'], $vars, $funcs))) return true; } catch (RErr $e) {}
      }
      return false;
    }
    foreach ($blk['matches'] as $m) {
      $v = $vars; $p = $pos; $ok = true;
      foreach ($m['segs'] as $s) {
        if ($p >= count($segs)) { $ok = false; break; }
        if ($s[0] === 'lit') { if ($segs[$p] !== $s[1]) { $ok = false; break; } $p++; }
        elseif ($s[2]) { $v[$s[1]] = new RPath(implode('/', array_slice($segs, $p))); $p = count($segs); }
        else { $v[$s[1]] = $segs[$p]; $p++; }
      }
      if ($ok && $this->walk($m, $segs, $p, $v, $funcs, $method, $kind)) return true;
    }
    return false;
  }
  private function truthy($v): bool { if (!is_bool($v)) throw new RErr('not a boolean'); return $v; }

  // ---------- evaluation ----------
  public static function ts(int $ms): stdClass { $o = new stdClass; $o->__t = $ms; return $o; }
  public static function isTs($v): bool { return $v instanceof stdClass && count((array)$v) === 1 && property_exists($v, '__t') && is_int($v->__t); }
  public static function isMap($v): bool { return $v instanceof stdClass && !self::isTs($v); }
  public static function isList($v): bool { return is_array($v); }

  private function ev(array $e, array $vars, array $funcs) {
    switch ($e[0]) {
      case 'lit': return $e[1];
      case 'var':
        if (array_key_exists($e[1], $vars)) return $vars[$e[1]];
        if ($e[1] === 'duration') return 'duration-ns';
        throw new RErr("unknown variable {$e[1]}");
      case 'list': return array_map(fn($x) => $this->ev($x, $vars, $funcs), $e[1]);
      case 'map': $o = new stdClass; foreach ($e[1] as [$k, $x]) $o->$k = $this->ev($x, $vars, $funcs); return $o;
      case 'path': $s = ''; foreach ($e[1] as [$t, $x]) $s .= '/' . ($t === 's' ? $x : $this->str($this->ev($x, $vars, $funcs))); return new RPath($s);
      case '?': return $this->truthy($this->ev($e[1], $vars, $funcs)) ? $this->ev($e[2], $vars, $funcs) : $this->ev($e[3], $vars, $funcs);
      case '||':
        try { $a = $this->ev($e[1], $vars, $funcs); if ($this->truthy($a)) return true; $aErr = null; } catch (RErr $x) { $aErr = $x; }
        $b = $this->truthy($this->ev($e[2], $vars, $funcs)); if ($b) return true; if ($aErr) throw $aErr; return false;
      case '&&':
        try { $a = $this->ev($e[1], $vars, $funcs); if (!$this->truthy($a)) return false; $aErr = null; } catch (RErr $x) { $aErr = $x; }
        $b = $this->truthy($this->ev($e[2], $vars, $funcs)); if (!$b) return false; if ($aErr) throw $aErr; return true;
      case '!': return !$this->truthy($this->ev($e[1], $vars, $funcs));
      case 'neg': $v = $this->ev($e[1], $vars, $funcs); if (!is_int($v) && !is_float($v)) throw new RErr('not a number'); return -$v;
      case 'cmp': return $this->cmp($e[1], $this->ev($e[2], $vars, $funcs), $this->ev($e[3], $vars, $funcs));
      case 'in': return $this->in($this->ev($e[1], $vars, $funcs), $this->ev($e[2], $vars, $funcs));
      case 'is': return $this->isType($this->ev($e[1], $vars, $funcs), $e[2]);
      case 'arith': return $this->arith($e[1], $this->ev($e[2], $vars, $funcs), $this->ev($e[3], $vars, $funcs));
      case 'field': return $this->field($this->ev($e[1], $vars, $funcs), $e[2]);
      case 'index':
        $o = $this->ev($e[1], $vars, $funcs); $k = $this->ev($e[2], $vars, $funcs);
        if (is_array($o)) { if (!is_int($k) || $k < 0 || $k >= count($o)) throw new RErr('index out of range'); return $o[$k]; }
        return $this->field($o, $this->str($k));
      case 'call': return $this->method($this->ev($e[1], $vars, $funcs), $e[2], array_map(fn($x) => $this->ev($x, $vars, $funcs), $e[3]));
      case 'fn': return $this->callFn($e[1], $e[2], $vars, $funcs);
    }
    throw new RErr('unknown expression ' . $e[0]);
  }
  private function str($v): string { if (!is_string($v)) throw new RErr('not a string'); return $v; }
  private function field($o, string $k) {
    if ($o === 'duration-ns') { if ($k === 'value') return 'duration.value'; throw new RErr('duration.' . $k); }
    if ($o instanceof stdClass && !self::isTs($o)) { if (!property_exists($o, $k)) throw new RErr("no field $k"); return $o->$k; }
    throw new RErr("can't read .$k");
  }
  private function callFn(string $name, array $argE, array $vars, array $funcs) {
    $args = array_map(fn($x) => $this->ev($x, $vars, $funcs), $argE);
    switch ($name) {
      case 'exists': case 'existsAfter': return $this->load($args[0], $name === 'existsAfter') !== null;
      case 'get': case 'getAfter':
        $d = $this->load($args[0], $name === 'getAfter'); if ($d === null) throw new RErr('document does not exist');
        return (object)['data' => $d, 'id' => basename($args[0]->p)];
      case 'int': return (int)$args[0];
      case 'float': return (float)$args[0];
      case 'string': return is_bool($args[0]) ? ($args[0] ? 'true' : 'false') : (string)$args[0];
    }
    if (!isset($funcs[$name])) throw new RErr("unknown function $name");
    $f = $funcs[$name]; $local = $vars;
    foreach ($f['params'] as $j => $p) $local[$p] = $args[$j] ?? null;
    foreach ($f['lets'] as [$n, $x]) $local[$n] = $this->ev($x, $local, $funcs);
    return $this->ev($f['body'], $local, $funcs);
  }
  private function load($path, bool $after) {
    if (!$path instanceof RPath) throw new RErr('not a path');
    $p = explode('/', trim($path->p, '/'));      // databases/(default)/documents/coll/id
    if (count($p) !== 5) throw new RErr('bad path ' . $path->p);
    $key = ($after ? 'A:' : 'B:') . $p[3] . '/' . $p[4];
    if (!array_key_exists($key, $this->cache)) $this->cache[$key] = ($this->getDoc)($p[3], $p[4], $after);
    return $this->cache[$key];
  }
  private function method($o, string $m, array $a) {
    if ($o === 'duration.value') throw new RErr('bad duration');
    if ($o === 'duration-ns' && $m === 'value') {
      $n = $a[0]; $u = $a[1];
      $mult = ['w' => 604800000, 'd' => 86400000, 'h' => 3600000, 'm' => 60000, 's' => 1000, 'ms' => 1, 'ns' => 0.000001][$u] ?? null;
      if ($mult === null) throw new RErr('bad duration unit'); return new RDur((int)round($n * $mult));
    }
    if (is_string($o)) {
      if ($m === 'size') return mb_strlen($o, 'UTF-8');
      if ($m === 'matches') { $re = '/^(?:' . str_replace('/', '\/', $a[0]) . ')$/su'; $r = @preg_match($re, $o); if ($r === false) throw new RErr('bad regex'); return $r === 1; }
      if ($m === 'lower') return mb_strtolower($o); if ($m === 'upper') return mb_strtoupper($o);
      if ($m === 'trim') return trim($o);
      throw new RErr("string.$m");
    }
    if (is_array($o)) { // list or set
      switch ($m) {
        case 'size': return count($o);
        case 'hasAny': foreach ($a[0] as $x) if ($this->in($x, $o)) return true; return false;
        case 'hasAll': foreach ($a[0] as $x) if (!$this->in($x, $o)) return false; return true;
        case 'hasOnly': foreach ($o as $x) if (!$this->in($x, $a[0])) return false; return true;
        case 'toSet': return array_values(array_unique($o, SORT_REGULAR));
      }
      throw new RErr("list.$m");
    }
    if ($o instanceof RDiff) {
      $ka = array_keys((array)$o->a); $kb = array_keys((array)$o->b);
      switch ($m) {
        case 'addedKeys': return array_values(array_diff($ka, $kb));
        case 'removedKeys': return array_values(array_diff($kb, $ka));
        case 'changedKeys': return array_values(array_filter(array_intersect($ka, $kb), fn($k) => !$this->eq($o->a->$k, $o->b->$k)));
        case 'unchangedKeys': return array_values(array_filter(array_intersect($ka, $kb), fn($k) => $this->eq($o->a->$k, $o->b->$k)));
        case 'affectedKeys': return array_values(array_merge(array_diff($ka, $kb), array_diff($kb, $ka),
          array_filter(array_intersect($ka, $kb), fn($k) => !$this->eq($o->a->$k, $o->b->$k))));
      }
      throw new RErr("diff.$m");
    }
    if (self::isMap($o)) {
      switch ($m) {
        case 'keys': return array_map('strval', array_keys((array)$o));
        case 'values': return array_values((array)$o);
        case 'size': return count((array)$o);
        case 'get': $k = $a[0]; if (is_array($k)) { $v = $o; foreach ($k as $part) { if (!self::isMap($v) || !property_exists($v, $part)) return $a[1]; $v = $v->$part; } return $v; }
          return property_exists($o, (string)$k) ? $o->{$k} : $a[1];
        case 'diff': if (!self::isMap($a[0])) throw new RErr('diff needs a map'); return new RDiff($o, $a[0]);
      }
      throw new RErr("map.$m");
    }
    if (self::isTs($o)) {
      $d = (int)floor($o->__t / 1000);
      switch ($m) {
        case 'toMillis': return $o->__t;
        case 'seconds': return $d;
        case 'year': return (int)gmdate('Y', $d); case 'month': return (int)gmdate('n', $d); case 'day': return (int)gmdate('j', $d);
      }
      throw new RErr("timestamp.$m");
    }
    throw new RErr("can't call .$m");
  }
  private function isType($v, string $t): bool {
    switch ($t) {
      case 'string': return is_string($v);
      case 'int': return is_int($v);
      case 'float': return is_float($v);
      case 'number': return is_int($v) || is_float($v);
      case 'bool': return is_bool($v);
      case 'null': return $v === null;
      case 'list': return is_array($v);
      case 'map': return self::isMap($v);
      case 'timestamp': return self::isTs($v);
      case 'duration': return $v instanceof RDur;
      case 'path': return $v instanceof RPath;
    }
    throw new RErr("unknown type $t");
  }
  private function in($x, $c): bool {
    if (is_array($c)) { foreach ($c as $y) if ($this->eq($x, $y)) return true; return false; }
    if (self::isMap($c)) return is_string($x) && property_exists($c, $x);
    throw new RErr("'in' needs a list or map");
  }
  public function eq($a, $b): bool {
    if ((is_int($a) || is_float($a)) && (is_int($b) || is_float($b))) return $a == $b;
    if (self::isTs($a) || self::isTs($b)) return self::isTs($a) && self::isTs($b) && $a->__t === $b->__t;
    if (is_array($a) || is_array($b)) {
      if (!is_array($a) || !is_array($b) || count($a) !== count($b)) return false;
      foreach (array_values($a) as $i => $x) if (!$this->eq($x, array_values($b)[$i])) return false; return true;
    }
    if ($a instanceof stdClass || $b instanceof stdClass) {
      if (!($a instanceof stdClass) || !($b instanceof stdClass)) return false;
      $aa = (array)$a; $bb = (array)$b; if (count($aa) !== count($bb)) return false;
      foreach ($aa as $k => $x) if (!array_key_exists($k, $bb) || !$this->eq($x, $bb[$k])) return false; return true;
    }
    if ($a instanceof RPath && $b instanceof RPath) return $a->p === $b->p;
    if ($a instanceof RDur && $b instanceof RDur) return $a->ms === $b->ms;
    return $a === $b;
  }
  private function cmp(string $op, $a, $b): bool {
    if ($op === '==') return $this->eq($a, $b);
    if ($op === '!=') return !$this->eq($a, $b);
    if ((is_int($a) || is_float($a)) && (is_int($b) || is_float($b))) $x = $a <=> $b;
    elseif (is_string($a) && is_string($b)) $x = strcmp($a, $b) <=> 0;
    elseif (self::isTs($a) && self::isTs($b)) $x = $a->__t <=> $b->__t;
    elseif ($a instanceof RDur && $b instanceof RDur) $x = $a->ms <=> $b->ms;
    else throw new RErr("can't compare");
    return match ($op) { '<' => $x < 0, '<=' => $x <= 0, '>' => $x > 0, '>=' => $x >= 0 };
  }
  private function arith(string $op, $a, $b) {
    $num = fn($v) => is_int($v) || is_float($v);
    if ($num($a) && $num($b)) {
      switch ($op) {
        case '+': return $a + $b; case '-': return $a - $b; case '*': return $a * $b;
        case '%': if ($b == 0) throw new RErr('modulo by zero'); return is_int($a) && is_int($b) ? $a % $b : fmod($a, $b);
      }
    }
    if ($op === '+' && is_string($a) && is_string($b)) return $a . $b;
    if ($op === '+' && is_array($a) && is_array($b)) return array_merge($a, $b);
    if (self::isTs($a) && $b instanceof RDur) return self::ts($op === '+' ? $a->__t + $b->ms : $a->__t - $b->ms);
    if ($op === '-' && self::isTs($a) && self::isTs($b)) return new RDur($a->__t - $b->__t);
    throw new RErr("can't $op these values");
  }
}
