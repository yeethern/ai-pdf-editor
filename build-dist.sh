#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/PDFEditor.app"
TEMP="$ROOT/.build-temp"

echo "=== Building PDFEditor.app ==="
echo ""

# 1. Clean
echo "[1/6] Cleaning..."
rm -rf "$APP" "$TEMP" "$ROOT/PDFEditor.zip" "$ROOT/PDFEditor-Windows.zip"

# 2. Build frontend
echo "[2/6] Building frontend..."
cd "$ROOT/frontend"
npm run build 2>&1 | tail -3

# 3. Create app bundle structure
echo "[3/6] Creating app bundle..."
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources/backend"
mkdir -p "$APP/Contents/Resources/frontend"

# 4. Copy files into bundle
echo "[4/6] Copying files..."

# Backend source
cp -R "$ROOT/backend/src" "$APP/Contents/Resources/backend/src"
cp "$ROOT/backend/package.json" "$APP/Contents/Resources/backend/"
cp "$ROOT/backend/tsconfig.json" "$APP/Contents/Resources/backend/"
cp "$ROOT/backend/eng.traineddata" "$APP/Contents/Resources/backend/" 2>/dev/null || true

# Fonts
if [ -d "$ROOT/backend/fonts" ]; then
  cp -R "$ROOT/backend/fonts" "$APP/Contents/Resources/backend/fonts"
fi

# Frontend build
cp -R "$ROOT/frontend/dist" "$APP/Contents/Resources/frontend/"

# .env (API key, gitignored, bundled into the app for end users)
if [ -f "$ROOT/backend/.env" ]; then
  cp "$ROOT/backend/.env" "$APP/Contents/Resources/backend/.env"
fi

# 5. Install dependencies
echo "[5/6] Installing backend dependencies..."
cd "$APP/Contents/Resources/backend"
npm install --omit=dev 2>&1 | tail -5
npm install tsx --no-save 2>&1 | tail -3

# 6. Create launchers
echo "[6/6] Creating launchers..."

# PkgInfo (required by macOS)
echo "APPL????" > "$APP/Contents/PkgInfo"

# macOS app executable
cat > "$APP/Contents/MacOS/PDFEditor" << 'SCRIPT'
#!/bin/bash
DIR="$(cd "$(dirname "$0")/../Resources" && pwd)"
cd "$DIR/backend"

# Check if already running
if lsof -ti :3001 &>/dev/null; then
  osascript -e 'display dialog "PDF Editor is already running.\n\nOpen http://localhost:3001 in your browser." buttons {"OK"} default button 1 with title "PDF Editor"'
  open http://localhost:3001
  exit 0
fi

LOG="$HOME/Library/Logs/PDFEditor.log"
NODE="/usr/local/bin/node"
if [ ! -x "$NODE" ]; then
  NODE="$(which node 2>/dev/null || echo "/usr/local/bin/node")"
fi
arch -arm64 "$NODE" node_modules/.bin/tsx src/index.ts > "$LOG" 2>&1 &
PID=$!
# Wait up to 30s for backend to respond
for i in $(seq 1 30); do
  if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    break
  fi
  if ! kill -0 $PID 2>/dev/null; then
    break
  fi
  sleep 1
done
if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
  open http://localhost:3001
else
  osascript -e "display dialog \"PDF Editor failed to start.\n\nCheck the log for details:\n$LOG\" buttons {\"OK\"} default button 1 with title \"PDF Editor\"" 2>/dev/null || \
  osascript -e "display dialog \"PDF Editor failed to start. Check ~/Library/Logs/PDFEditor.log\" buttons {\"OK\"} default button 1 with title \"PDF Editor\""
fi
wait
SCRIPT
chmod +x "$APP/Contents/MacOS/PDFEditor"

# Info.plist
cat > "$APP/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>PDFEditor</string>
    <key>CFBundleIdentifier</key>
    <string>com.pdfeditor.app</string>
    <key>CFBundleName</key>
    <string>PDF Editor</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>PDF Editor</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

# Windows batch launcher
mkdir -p "$TEMP"
cat > "$TEMP/start.command" << 'CMDECMD'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/backend"
node node_modules/.bin/tsx src/index.ts
CMDECMD

cat > "$TEMP/start.bat" << 'BAT'
@echo off
cd /d "%~dp0backend"
start "" http://localhost:3001
npx tsx src/index.ts
pause
BAT

cat > "$TEMP/start.vbs" << 'VBS'
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\backend"
WshShell.Run "cmd /c npx tsx src\index.ts", 0, False
WScript.Sleep 2000
WshShell.Run "http://localhost:3001"
VBS

# Create macOS zip (app only)
echo ""
echo "Creating PDFEditor.zip (macOS)..."
cd "$ROOT"
zip -ry "PDFEditor.zip" "PDFEditor.app" -x "*/node_modules/.cache/*" > /dev/null 2>&1

# Create Windows zip (backend + launchers)
echo "Creating PDFEditor-Windows.zip (Windows)..."
mkdir -p "$TEMP/backend" "$TEMP/frontend"
cp "$TEMP/start.bat" "$TEMP/"
cp "$TEMP/start.vbs" "$TEMP/"
cp -R "$ROOT/backend/src" "$TEMP/backend/src"
cp "$ROOT/backend/package.json" "$TEMP/backend/"
cp "$ROOT/backend/tsconfig.json" "$TEMP/backend/"
cp -R "$ROOT/backend/fonts" "$TEMP/backend/" 2>/dev/null || true
cp -R "$ROOT/frontend/dist/" "$TEMP/frontend/"
cd "$TEMP"
npm install --prefix backend --omit=dev 2>&1 | tail -1
npm install --prefix backend tsx --no-save 2>&1 | tail -1
npm install --prefix backend @esbuild/win32-x64 --no-save 2>/dev/null || true
zip -r "$ROOT/PDFEditor-Windows.zip" . -x "*/node_modules/.cache/*" > /dev/null 2>&1

# Cleanup
rm -rf "$TEMP"

# Sizes
APP_SIZE=$(du -sh "$APP" | cut -f1)
ZIP_SIZE=$(du -h "$ROOT/PDFEditor.zip" | cut -f1)
WIN_SIZE=$(du -h "$ROOT/PDFEditor-Windows.zip" | cut -f1 2>/dev/null || echo "N/A")

echo ""
echo "=== Done ==="
echo "  macOS app: $APP_SIZE"
echo "  macOS zip: $ZIP_SIZE"
echo "  Windows zip: $WIN_SIZE"
echo ""
echo "How to use:"
echo "  macOS: Unzip PDFEditor.zip → double-click PDFEditor.app"
echo "  Windows: Unzip PDFEditor-Windows.zip → double-click start.vbs"
echo ""
echo "Note: macOS will show \"unverified developer\" on first launch."
echo "  Right-click PDFEditor.app → Open → click Open."
echo "  After that, just double-click to open."
echo ""
echo "Users need Node.js installed (https://nodejs.org)."
echo "On first run, 'npx tsx' will auto-install (one-time)."
