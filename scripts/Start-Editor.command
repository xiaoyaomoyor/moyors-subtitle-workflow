#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -d "MSW.app" ]; then
  exec ./MSW.app/Contents/MacOS/MSW --editor "$@"
fi
exec ./MSW-lite.app/Contents/MacOS/MSW --editor "$@"
