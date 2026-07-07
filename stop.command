#!/bin/bash
PORT=3001
PID=$(lsof -ti :$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  kill $PID 2>/dev/null
  echo "PDF Editor stopped (port $PORT)."
else
  echo "PDF Editor is not running."
fi
osascript -e 'display notification "PDF Editor has been stopped." with title "PDF Editor"' 2>/dev/null || true
