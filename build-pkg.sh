#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

INSTALL=0
NO_BUILD=0
OPEN_OUTPUT=0
SIGN_IDENTITY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      INSTALL=1
      shift
      ;;
    --no-build)
      NO_BUILD=1
      shift
      ;;
    --open-output)
      OPEN_OUTPUT=1
      shift
      ;;
    --sign)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --sign" >&2
        exit 1
      fi
      SIGN_IDENTITY="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: ./build-pkg.sh [--install] [--no-build] [--open-output] [--sign \"Developer ID Installer: ...\"]" >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must be run on macOS." >&2
  exit 1
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

json_value() {
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(process.argv[2].split('.').reduce((acc,key)=>acc?.[key], data) ?? '');" "$1" "$2"
}

require_command node
require_command npm
require_command pkgbuild
require_command productbuild

if [[ $INSTALL -eq 1 || ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo "==> Installing npm dependencies"
  npm install
fi

PRODUCT_NAME="$(json_value "$SCRIPT_DIR/src-tauri/tauri.conf.json" "productName")"
APP_VERSION="$(json_value "$SCRIPT_DIR/src-tauri/tauri.conf.json" "version")"
APP_IDENTIFIER="$(json_value "$SCRIPT_DIR/src-tauri/tauri.conf.json" "identifier")"
ARCH="$(uname -m)"
APP_OUTPUT_DIR="$SCRIPT_DIR/src-tauri/target/release/bundle/macos"
PKG_OUTPUT_DIR="$SCRIPT_DIR/src-tauri/target/release/bundle/pkg"
APP_BUNDLE_PATH="$APP_OUTPUT_DIR/$PRODUCT_NAME.app"
UNSIGNED_COMPONENT_PKG="$PKG_OUTPUT_DIR/${PRODUCT_NAME}-${APP_VERSION}-${ARCH}.component.pkg"
FINAL_PKG_PATH="$PKG_OUTPUT_DIR/${PRODUCT_NAME}_${APP_VERSION}_${ARCH}.pkg"

if [[ $NO_BUILD -eq 1 ]]; then
  echo "Validation passed."
  echo "Product: $PRODUCT_NAME"
  echo "Version: $APP_VERSION"
  echo "Identifier: $APP_IDENTIFIER"
  echo "App bundle: $APP_BUNDLE_PATH"
  echo "PKG output: $FINAL_PKG_PATH"
  exit 0
fi

echo "==> Building macOS app bundle"
npm run tauri:build -- --bundles app

if [[ ! -d "$APP_BUNDLE_PATH" ]]; then
  echo "Build finished but app bundle was not found: $APP_BUNDLE_PATH" >&2
  exit 1
fi

mkdir -p "$PKG_OUTPUT_DIR"
rm -f "$UNSIGNED_COMPONENT_PKG" "$FINAL_PKG_PATH"

echo "==> Creating component package"
pkgbuild \
  --component "$APP_BUNDLE_PATH" \
  --install-location /Applications \
  --identifier "$APP_IDENTIFIER" \
  --version "$APP_VERSION" \
  "$UNSIGNED_COMPONENT_PKG"

echo "==> Creating installer package"
PRODUCTBUILD_ARGS=(
  --package "$UNSIGNED_COMPONENT_PKG"
  "$FINAL_PKG_PATH"
)

if [[ -n "$SIGN_IDENTITY" ]]; then
  PRODUCTBUILD_ARGS=(
    --sign "$SIGN_IDENTITY"
    "${PRODUCTBUILD_ARGS[@]}"
  )
fi

productbuild "${PRODUCTBUILD_ARGS[@]}"

echo "==> PKG created"
echo "$FINAL_PKG_PATH"

if [[ $OPEN_OUTPUT -eq 1 ]]; then
  open "$PKG_OUTPUT_DIR"
fi
