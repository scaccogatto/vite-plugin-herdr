#!/bin/sh
# Fake `screencapture` for tests: never touches the real screen. Writes a
# valid 1x1 PNG to its last argument and exits 0, mirroring
# `screencapture -x -R x,y,w,h <file>`'s contract. Set FAKE_SCREENCAPTURE_FAIL=1
# to make it fail without writing anything, exercising the capture-failure path.

if [ "$FAKE_SCREENCAPTURE_FAIL" = "1" ]; then
  exit 1
fi

for out; do :; done

# A minimal but valid 1x1 PNG (8-bit gray+alpha), base64-encoded.
B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

printf '%s' "$B64" | base64 --decode > "$out"
