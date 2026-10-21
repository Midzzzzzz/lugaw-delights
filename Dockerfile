# Lugaw Delights on Render: the website (public/) and the API (server/) in one PHP + Apache container.
# The database is Render PostgreSQL; its address arrives as DATABASE_URL (see render.yaml).
FROM php:8.2-apache

RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev \
 && docker-php-ext-install pdo_pgsql \
 && apt-get purge -y --auto-remove && rm -rf /var/lib/apt/lists/* \
 && a2enmod headers expires \
 && mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

COPY deploy/php.ini $PHP_INI_DIR/conf.d/lugaw.ini
COPY deploy/apache.conf /etc/apache2/conf-enabled/lugaw.conf
# Render tells the app which port to use (PORT, 10000 by default)
ENV PORT=10000
RUN sed -i 's/Listen 80/Listen ${PORT}/' /etc/apache2/ports.conf \
 && sed -i 's/<VirtualHost \*:80>/<VirtualHost *:${PORT}>/' /etc/apache2/sites-available/000-default.conf

# The API code and the rules live outside the website folder; only api/index.php is reachable
COPY server/index.php /var/www/server/index.php
COPY server/lib/ /var/www/server/lib/
COPY firestore.rules /var/www/server/firestore.rules
COPY public/ /var/www/html/
RUN mkdir -p /var/www/html/api \
 && printf '<?php\nrequire "/var/www/server/index.php";\n' > /var/www/html/api/index.php \
 && chown -R www-data:www-data /var/www/server
