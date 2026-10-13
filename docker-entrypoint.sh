#!/bin/sh
set -e

echo "applying migrations..."
node node_modules/drizzle-kit/bin.cjs migrate
echo "migrations applied, starting next..."
exec node node_modules/next/dist/bin/next start
