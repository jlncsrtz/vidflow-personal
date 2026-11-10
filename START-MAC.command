#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is missing. Install Node.js 20+ from https://nodejs.org then try again.'
  read -r -p 'Press Enter to close...'
  exit 1
fi
if ! command -v yt-dlp >/dev/null 2>&1 || ! command -v ffmpeg >/dev/null 2>&1; then
  echo 'yt-dlp or FFmpeg is missing. Install Homebrew, then run: brew install yt-dlp ffmpeg deno'
  read -r -p 'Press Enter to close...'
  exit 1
fi
(sleep 2; open 'http://127.0.0.1:4317') &
node server.js
