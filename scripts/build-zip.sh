#!/bin/sh
# 配布用zipを dist/ に作る
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./extension/manifest.json').version")
mkdir -p dist
rm -f "dist/local-autofill-$VERSION.zip"
(cd extension && zip -qr "../dist/local-autofill-$VERSION.zip" . -x '.*')
echo "dist/local-autofill-$VERSION.zip"
