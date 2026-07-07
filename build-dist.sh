#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/PDFEditor-dist"
NAME="PDFEditor"

echo "=== Building $NAME Distribution ==="
echo ""

# 1. Build frontend
echo "[1/5] Building frontend..."
cd "$ROOT/frontend"
npm run build

# 2. Prepare dist directory
echo "[2/5] Creating distribution layout..."
rm -rf "$DIST"
mkdir -p "$DIST/backend"
mkdir -p "$DIST/frontend"
mkdir -p "$DIST/fonts"

# 3. Copy frontend build
echo "[3/5] Copying frontend build..."
cp -R "$ROOT/frontend/dist/" "$DIST/frontend/"

# 4. Copy backend source files
echo "[4/5] Copying backend..."
cp "$ROOT/backend/package.json" "$DIST/backend/"
cp "$ROOT/backend/tsconfig.json" "$DIST/backend/"
cp -R "$ROOT/backend/src" "$DIST/backend/src"
cp "$ROOT/backend/eng.traineddata" "$DIST/backend/" 2>/dev/null || true

# 5. Copy fonts
if [ -d "$ROOT/backend/fonts" ]; then
  cp -R "$ROOT/backend/fonts/" "$DIST/fonts/"
fi

# 6. Install production dependencies
echo "[5/5] Installing backend dependencies..."
cd "$DIST/backend"
npm install --omit=dev --ignore-scripts 2>&1 | tail -3

# Rebuild native modules (canvas, sharp need this)
npx --yes node-gyp rebuild 2>/dev/null || true
npx --yes @mapbox/node-pre-gyp rebuild 2>/dev/null || true

# 7. Create launchers
echo ""
echo "Creating launchers..."

# Copy stop.command
cp "$ROOT/stop.command" "$DIST/stop.command"

# macOS .command
cat > "$DIST/start.command" << 'CMDECMD'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/backend"
npx tsx src/index.ts
CMDECMD
chmod +x "$DIST/start.command"

# macOS .app (shows in dock, right-click to Quit)
mkdir -p "$DIST/PDFEditor.app/Contents/MacOS"
cat > "$DIST/PDFEditor.app/Contents/MacOS/PDFEditor" << 'APPSH'
#!/bin/bash
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$DIR/backend"
npx tsx src/index.ts &
sleep 2
open http://localhost:3001
osascript -e 'display notification "PDF Editor is running. Click Quit from the dock to stop." with title "PDF Editor"' 2>/dev/null || true
wait
APPSH
chmod +x "$DIST/PDFEditor.app/Contents/MacOS/PDFEditor"

cat > "$DIST/PDFEditor.app/Contents/Info.plist" << 'PLIST'
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
</dict>
</plist>
PLIST

# Windows .vbs (runs hidden)
cat > "$DIST/start.vbs" << 'VBS'
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\backend"
WshShell.Run "cmd /c npx tsx src\index.ts", 0, False
WScript.Sleep 2000
WshShell.Run "http://localhost:3001"
VBS

# Windows .bat (shows terminal, fallback)
cat > "$DIST/start.bat" << 'BAT'
@echo off
cd /d "%~dp0backend"
start "" http://localhost:3001
npx tsx src/index.ts
pause
BAT

# 8. Create zip
echo ""
echo "Creating zip..."
cd "$ROOT"
rm -f "$NAME.zip"
zip -r "$NAME.zip" "$(basename "$DIST")" -x "*/node_modules/.cache/*" "*/node_modules/.package-lock.json" > /dev/null 2>&1

# Summary
SIZE=$(du -sh "$DIST" | cut -f1)
ZIP_SIZE=$(du -h "$NAME.zip" | cut -f1)
echo ""
echo "=== Done ==="
echo "  Distribution folder: $DIST ($SIZE)"
echo "  Zip archive: $ROOT/$NAME.zip ($ZIP_SIZE)"
echo ""
echo "To distribute:"
echo "  macOS: Upload PDFEditor.zip, users download, unzip, double-click PDFEditor.app"
echo "  To stop: double-click stop.command, or right-click PDFEditor.app in dock → Quit"
echo "  Windows: Users unzip, double-click start.vbs (hidden) or start.bat (terminal)"
echo ""
echo "Users need Node.js installed."
echo "On first run, 'npx tsx' will auto-install tsx."
