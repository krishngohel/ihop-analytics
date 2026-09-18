#!/bin/bash
# Builds "IHOP Operations.app" and the .dmg the client drags into Applications.
#   packaging/build-mac.sh            (run on a Mac with the Xcode command line tools)
#
# The app carries its own copy of Node, so nothing else has to be installed. Optional:
#   MAC_SIGN_IDENTITY="Developer ID Application: Name (TEAMID)"   sign for distribution
#   MAC_NOTARY_PROFILE=<notarytool keychain profile>              notarize and staple
# Without those the app is ad-hoc signed: it runs, but macOS warns the first time it is opened.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="${NODE_VERSION:-v24.21.0}"
VERSION="$(node -p "require('$ROOT/server/package.json').version")"
APP_NAME="IHOP Operations"
BUILD="$ROOT/release/mac"
APP="$BUILD/$APP_NAME.app"
CACHE="$ROOT/release/.cache"
DMG="$ROOT/release/IHOP-Operations-$VERSION.dmg"

echo "== Frontend and server components"
[ -d "$ROOT/client/node_modules" ] || (cd "$ROOT/client" && npm ci)
(cd "$ROOT/client" && npm run build >/dev/null)
STAGE="$BUILD/stage"
rm -rf "$BUILD"; mkdir -p "$STAGE/server" "$STAGE/client" "$CACHE"
cp -R "$ROOT/server/src" "$ROOT/server/package.json" "$ROOT/server/package-lock.json" "$STAGE/server/"
cp -R "$ROOT/client/dist" "$STAGE/client/dist"
# A clean production install, not this machine's node_modules.
(cd "$STAGE/server" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)

echo "== Node $NODE_VERSION for Apple silicon and Intel"
curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$CACHE/SHASUMS256-$NODE_VERSION.txt"
for arch in arm64 x64; do
  tarball="node-$NODE_VERSION-darwin-$arch.tar.gz"
  [ -f "$CACHE/$tarball" ] || curl -fSL --progress-bar "https://nodejs.org/dist/$NODE_VERSION/$tarball" -o "$CACHE/$tarball"
  want="$(grep " $tarball\$" "$CACHE/SHASUMS256-$NODE_VERSION.txt" | cut -d' ' -f1)"
  have="$(shasum -a 256 "$CACHE/$tarball" | cut -d' ' -f1)"
  [ -n "$want" ] && [ "$want" = "$have" ] || { echo "Checksum mismatch for $tarball"; rm -f "$CACHE/$tarball"; exit 1; }
  mkdir -p "$BUILD/node-$arch"
  tar -xzf "$CACHE/$tarball" -C "$BUILD/node-$arch" --strip-components=2 "node-$NODE_VERSION-darwin-$arch/bin/node"
done

echo "== App bundle"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create "$BUILD/node-arm64/node" "$BUILD/node-x64/node" -output "$APP/Contents/Resources/node"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos12.0" "$ROOT/packaging/mac/Launcher.swift" -o "$BUILD/launcher-$arch"
done
lipo -create "$BUILD/launcher-arm64" "$BUILD/launcher-x86_64" -output "$APP/Contents/MacOS/$APP_NAME"
sed "s/__VERSION__/$VERSION/g" "$ROOT/packaging/mac/Info.plist" > "$APP/Contents/Info.plist"
cp "$ROOT/packaging/assets/icon.icns" "$ROOT/packaging/assets/menubar.png" "$ROOT/packaging/assets/menubar@2x.png" "$APP/Contents/Resources/"
mv "$STAGE" "$APP/Contents/Resources/app"
rm -rf "$BUILD"/node-* "$BUILD"/launcher-*

echo "== Signing"
IDENTITY="${MAC_SIGN_IDENTITY:--}"
ENTITLEMENTS="$ROOT/packaging/mac/node.entitlements"
# Node's JIT needs these under the hardened runtime.
codesign --force --options runtime --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$APP/Contents/Resources/node"
codesign --force --options runtime --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"

echo "== Disk image"
DMGSRC="$BUILD/dmg"; mkdir -p "$DMGSRC"
mv "$APP" "$DMGSRC/"; ln -s /Applications "$DMGSRC/Applications"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$DMGSRC" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$DMG" >/dev/null
rm -rf "$BUILD" # only the disk image is kept: a loose copy of the app confuses Launch Services and Spotlight
if [ "$IDENTITY" != "-" ]; then
  codesign --force --sign "$IDENTITY" "$DMG"
  if [ -n "${MAC_NOTARY_PROFILE:-}" ]; then
    xcrun notarytool submit "$DMG" --keychain-profile "$MAC_NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG"
  fi
fi
echo "Built $DMG ($(du -h "$DMG" | cut -f1))"
