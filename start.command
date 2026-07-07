#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/backend"

echo "Starting PDF Editor backend..."
echo "Open http://localhost:3001 in your browser."
echo "Press Ctrl+C to stop the server."
echo ""

npx tsx src/index.ts
