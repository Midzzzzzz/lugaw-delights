<?php
// Copy this to lugaw-config.php in your hosting home folder (ONE LEVEL ABOVE the website folder,
// e.g. /home/youruser/lugaw-config.php) and fill in the MySQL details from cPanel → MySQL Databases.
return [
  'db' => ['dsn' => 'mysql:host=localhost;dbname=CPANELUSER_lugaw;charset=utf8mb4', 'user' => 'CPANELUSER_lugaw', 'pass' => 'THE-DATABASE-PASSWORD'],
  'site_url' => 'https://lugawdelights.com',
  'mail_from' => 'no-reply@lugawdelights.com',
  // other addresses allowed to call the API (the site itself needs none)
  'origins' => ['https://lugawdelights.com', 'https://www.lugawdelights.com'],
];
