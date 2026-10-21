#!/bin/sh
# Build the signed, notarized, stapled Intel release DMG on this Mac.
#
# Needs the Developer ID Application certificate in the keychain and an App Store
# Connect API key, passed as APPLE_API_KEY (key ID), APPLE_API_ISSUER, and
# APPLE_API_KEY_PATH (the .p8). The same key must be saved as the notarytool
# profile "bustermark-notary":
#   xcrun notarytool store-credentials bustermark-notary --key <p8> --key-id <id> --issuer <issuer>
#
# Tauri signs and notarizes the app, staples it, then builds and signs the DMG.
# It never submits the DMG, so that step is done here.
set -eu
: "${APPLE_API_KEY:?set APPLE_API_KEY to the key ID}"
: "${APPLE_API_ISSUER:?set APPLE_API_ISSUER}"
: "${APPLE_API_KEY_PATH:?set APPLE_API_KEY_PATH to the .p8 file}"
# The certificate's SHA-1: its name matches copies in both the login and System keychains.
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-21D1A27D1D2ACB03DF693708BA7D30F4B15F641D}"
export APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH

cd "$(dirname "$0")/.."
bun run tauri build --target x86_64-apple-darwin --bundles app,dmg

version=$(python3 -c "import json; print(json.load(open('src-tauri/tauri.conf.json'))['version'])")
bundle=src-tauri/target/x86_64-apple-darwin/release/bundle
dmg="$bundle/dmg/BusterMark_${version}_x64.dmg"

xcrun stapler validate "$bundle/macos/BusterMark.app"
xcrun notarytool submit "$dmg" --keychain-profile bustermark-notary --wait
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
spctl -a -vv -t open --context context:primary-signature "$dmg"
shasum -a 256 "$dmg"
