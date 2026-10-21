<?php
// Accounts and sign-in: email + password (staff), and anonymous accounts (customers ordering).
// A sign-in returns a random token that the page sends with every request. Error codes match
// Firebase's (auth/...), so the pages' messages stay the same.

final class Auth {
  public function __construct(private PDO $db, private array $cfg) {}

  private static function newId(int $n = 28): string {
    $a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; $s = '';
    for ($i = 0; $i < $n; $i++) $s .= $a[random_int(0, 61)];
    return $s;
  }
  private function session(string $uid): string {
    $t = bin2hex(random_bytes(32)); $now = Store::now();
    $this->db->prepare('INSERT INTO sessions (token, uid, created, seen) VALUES (?, ?, ?, ?)')->execute([$t, $uid, $now, $now]);
    return $t;
  }
  private function out(array $u, ?string $token = null): array {
    return ['uid' => $u['uid'], 'email' => $u['email'], 'isAnonymous' => $u['provider'] === 'anonymous', 'provider' => $u['provider']] + ($token ? ['token' => $token] : []);
  }
  private function limit(string $key, int $max, int $windowMs): void {
    $now = Store::now();
    $q = $this->db->prepare('SELECT n, until FROM hits WHERE k = ?'); $q->execute([$key]); $r = $q->fetch(PDO::FETCH_ASSOC);
    if ($r && (int)$r['until'] > $now) {
      if ((int)$r['n'] >= $max) throw new ApiError('auth/too-many-requests', 'Too many attempts. Try again in a few minutes.', 429);
      $this->db->prepare('UPDATE hits SET n = n + 1 WHERE k = ?')->execute([$key]);
    } else $this->db->prepare(Store::isPg($this->db)
        ? 'INSERT INTO hits (k, n, until) VALUES (?, 1, ?) ON CONFLICT (k) DO UPDATE SET n = 1, until = EXCLUDED.until'
        : 'REPLACE INTO hits (k, n, until) VALUES (?, 1, ?)')->execute([$key, $now + $windowMs]);
  }
  // The visitor's address. Behind Render's proxy every request comes from the proxy, so the
  // address it passes on (X-Forwarded-For) is used instead.
  private function ip(): string {
    $fwd = !empty($this->cfg['behind_proxy']) ? trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '')[0]) : '';
    return $fwd !== '' ? $fwd : ($_SERVER['REMOTE_ADDR'] ?? '');
  }
  private static function cleanEmail($e): string {
    $e = strtolower(trim((string)$e));
    if (!filter_var($e, FILTER_VALIDATE_EMAIL)) throw new ApiError('auth/invalid-email', 'That email address doesn\'t look right.');
    return $e;
  }

  // The signed-in user for a token (null if none or expired)
  public function user(?string $token): ?array {
    if (!$token || !preg_match('/^[0-9a-f]{64}$/', $token)) return null;
    $q = $this->db->prepare('SELECT u.uid, u.email, u.provider, s.seen FROM sessions s JOIN users u ON u.uid = s.uid WHERE s.token = ?');
    $q->execute([$token]); $u = $q->fetch(PDO::FETCH_ASSOC);
    if (!$u) return null;
    $now = Store::now();
    if ($now - (int)$u['seen'] > 3600000) $this->db->prepare('UPDATE sessions SET seen = ? WHERE token = ?')->execute([$now, $token]);
    return $u;
  }
  // As the rules see it: request.auth
  public static function ruleAuth(?array $u): ?stdClass {
    if (!$u) return null;
    return (object)['uid' => $u['uid'], 'token' => (object)['email' => $u['email'] ?? '', 'firebase' => (object)['sign_in_provider' => $u['provider']]]];
  }

  public function signup($email, $pass): array {
    $email = self::cleanEmail($email);
    $this->limit('signup:' . $this->ip(), 10, 3600000);
    if (!is_string($pass) || strlen($pass) < 6) throw new ApiError('auth/weak-password', 'Use a password with at least 6 characters.');
    $q = $this->db->prepare('SELECT 1 FROM users WHERE email = ?'); $q->execute([$email]);
    if ($q->fetchColumn()) throw new ApiError('auth/email-already-in-use', 'That email already has an account.');
    $u = ['uid' => self::newId(), 'email' => $email, 'provider' => 'password'];
    $this->db->prepare('INSERT INTO users (uid, email, pass, provider, created) VALUES (?, ?, ?, ?, ?)')
      ->execute([$u['uid'], $email, password_hash($pass, PASSWORD_DEFAULT), 'password', Store::now()]);
    return $this->out($u, $this->session($u['uid']));
  }
  // Signs in with an email, or with the username the owner gave (anything without an @)
  public function login($email, $pass): array {
    $id = strtolower(trim((string)$email));
    $byName = $id !== '' && !str_contains($id, '@');
    if (!$byName) $id = self::cleanEmail($id);
    $this->limit('login:' . $id, 10, 600000);
    $q = $this->db->prepare('SELECT uid, email, pass, provider FROM users WHERE ' . ($byName ? 'username' : 'email') . ' = ?'); $q->execute([$id]); $u = $q->fetch(PDO::FETCH_ASSOC);
    if (!$u || !$u['pass'] || !password_verify((string)$pass, $u['pass'])) throw new ApiError('auth/invalid-credential', 'Wrong username, email or password.', 401);
    return $this->out($u, $this->session($u['uid']));
  }
  public function anonymous(): array {
    $this->limit('anon:' . $this->ip(), 60, 3600000);
    $u = ['uid' => self::newId(), 'email' => null, 'provider' => 'anonymous'];
    $this->db->prepare('INSERT INTO users (uid, email, pass, provider, created) VALUES (?, NULL, NULL, ?, ?)')->execute([$u['uid'], 'anonymous', Store::now()]);
    return $this->out($u, $this->session($u['uid']));
  }
  public function me(?string $token): ?array { $u = $this->user($token); return $u ? $this->out($u) : null; }
  public function logout(?string $token): void { if ($token) $this->db->prepare('DELETE FROM sessions WHERE token = ?')->execute([$token]); }
  // Checks the password again before a sensitive change (the rider's payout account)
  public function reauth(?string $token, $pass): void {
    $u = $this->user($token); if (!$u) throw new ApiError('auth/requires-recent-login', 'Please sign in again.', 401);
    $this->limit('reauth:' . $u['uid'], 10, 600000);
    $q = $this->db->prepare('SELECT pass FROM users WHERE uid = ?'); $q->execute([$u['uid']]);
    if (!password_verify((string)$pass, (string)$q->fetchColumn())) throw new ApiError('auth/invalid-credential', 'Wrong password.', 401);
  }
  // Sends a link to choose a new password (reset.html). Says nothing about whether the email exists.
  public function sendReset($email): void {
    $email = self::cleanEmail($email);
    $this->limit('reset:' . $email, 5, 3600000);
    $q = $this->db->prepare('SELECT uid FROM users WHERE email = ? AND provider = ?'); $q->execute([$email, 'password']); $uid = $q->fetchColumn();
    if (!$uid) return;
    $t = bin2hex(random_bytes(32));
    $this->db->prepare('INSERT INTO resets (token, uid, expires) VALUES (?, ?, ?)')->execute([$t, $uid, Store::now() + 3600000]);
    $site = rtrim($this->cfg['site_url'] ?? '', '/');
    $link = "$site/reset.html#$t";
    $from = $this->cfg['mail_from'] ?? 'no-reply@' . parse_url($site, PHP_URL_HOST);
    $subject = 'Reset your Lugaw Delights password';
    $body = "Someone asked to reset the password for this email on Lugaw Delights.\n\nChoose a new password here (the link works for 1 hour):\n$link\n\nIf it wasn't you, ignore this email.";
    if (!empty($this->cfg['resend_key'])) { // Render: sent through Resend (resend.com)
      $ch = curl_init('https://api.resend.com/emails');
      curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $this->cfg['resend_key'], 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode(['from' => "Lugaw Delights <$from>", 'to' => [$email], 'subject' => $subject, 'text' => $body])]);
      $res = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
      if ($code >= 300) error_log("Lugaw API: reset email not sent ($code): $res");
    } else @mail($email, $subject, $body, "From: Lugaw Delights <$from>\r\nContent-Type: text/plain; charset=utf-8");
  }
  // Only the owner (an account listed in "admins") may manage staff sign-ins
  private function owner(?string $token): array {
    $me = $this->user($token);
    if (!$me) throw new ApiError('permission-denied', 'Please sign in again.', 403);
    $q = $this->db->prepare("SELECT 1 FROM docs WHERE coll = 'admins' AND id = ?"); $q->execute([$me['uid']]);
    if (!$q->fetchColumn()) throw new ApiError('permission-denied', 'Only the owner can change staff sign-ins.', 403);
    return $me;
  }
  // The owner gives a staff member a username and/or a new password (no email needed).
  // null leaves that part as it is; a new password signs them out everywhere.
  public function setLoginFor(?string $token, $uid, $username, $pass): void {
    $me = $this->owner($token);
    $this->limit('setpw:' . $me['uid'], 60, 3600000);
    $uid = (string)$uid;
    $q = $this->db->prepare('SELECT uid FROM users WHERE uid = ? AND provider = ?'); $q->execute([$uid, 'password']);
    if (!$q->fetchColumn()) throw new ApiError('not-found', 'That person has no sign-in account.', 404);
    if ($username !== null) {
      $name = strtolower(trim((string)$username));
      if (!preg_match('/^[a-z0-9._-]{3,30}$/', $name))
        throw new ApiError('invalid-argument', 'A username needs 3 to 30 letters or numbers (dots, dashes and _ are OK; no spaces).');
      $q = $this->db->prepare('SELECT 1 FROM users WHERE username = ? AND uid <> ?'); $q->execute([$name, $uid]);
      if ($q->fetchColumn()) throw new ApiError('already-exists', "Someone else already has the username \"$name\".");
      $this->db->prepare('UPDATE users SET username = ? WHERE uid = ?')->execute([$name, $uid]);
    }
    if ($pass !== null) {
      if (!is_string($pass) || strlen($pass) < 6) throw new ApiError('auth/weak-password', 'Use a password with at least 6 characters.');
      $this->db->prepare('UPDATE users SET pass = ? WHERE uid = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), $uid]);
      $this->db->prepare('DELETE FROM sessions WHERE uid = ? AND token <> ?')->execute([$uid, (string)$token]);
      $this->db->prepare('DELETE FROM resets WHERE uid = ?')->execute([$uid]);
    }
  }
  // Usernames of everyone who has one (for the owner's staff list)
  public function usernames(?string $token): array {
    $this->owner($token);
    return $this->db->query('SELECT uid, username FROM users WHERE username IS NOT NULL')->fetchAll(PDO::FETCH_KEY_PAIR);
  }
  public function finishReset($token, $pass): void {
    if (!is_string($pass) || strlen($pass) < 6) throw new ApiError('auth/weak-password', 'Use a password with at least 6 characters.');
    $q = $this->db->prepare('SELECT uid, expires FROM resets WHERE token = ?'); $q->execute([(string)$token]); $r = $q->fetch(PDO::FETCH_ASSOC);
    if (!$r || (int)$r['expires'] < Store::now()) throw new ApiError('auth/expired-action-code', 'This link has expired. Ask for a new one.');
    $this->db->prepare('UPDATE users SET pass = ? WHERE uid = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), $r['uid']]);
    $this->db->prepare('DELETE FROM resets WHERE uid = ?')->execute([$r['uid']]);
    $this->db->prepare('DELETE FROM sessions WHERE uid = ?')->execute([$r['uid']]); // sign out everywhere
  }
}
