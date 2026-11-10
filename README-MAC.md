# VidFlow Personal v2 — MP4 only, dynamic quality detection

## What changed

- MP3 removed. Output is MP4 only.
- Paste a video URL, then click **Check video & qualities**.
- Dropdown contains only video heights reported by `yt-dlp` for that particular URL, ordered highest to lowest.
- Select the exact quality you want, then click **Download MP4**.
- To improve transfers when possible, the downloader prefers a direct HTTPS MP4 stream, then adaptive HTTPS streams, then fragmented streams, and uses 8 concurrent fragments where supported. This does not guarantee fast downloads.
- Videos are saved in `~/Downloads/VidFlow`.

## Installation (Mac)

Install Node.js and Homebrew, then:

```bash
cd ~
brew install yt-dlp ffmpeg deno
```

Extract the ZIP and open Terminal inside the `vidflow-personal` folder. Start with:

```bash
node server.js
```

Open http://127.0.0.1:4317. To quit, press Control+C in Terminal.

If the browser still displays the old layout, reload using **Command+Shift+R**, and make sure the old server is stopped.

## Important notes

- A reported height means a video stream is advertised by the platform. It does not guarantee that stream is accessible, that its codec can be remuxed to MP4, or that the download is permitted.
- FFmpeg may need to merge audio and video for higher resolutions, and that takes additional time.
- Some platforms show no usable qualities or block extraction. Authentication / private / DRM content are not bypassed.
- The project is intended for content you own or are authorized to download. Follow each site's rules.
- Server binds only to 127.0.0.1 (this Mac), not the public internet.


## New: Cancel downloads
While downloading, click **Cancel download**. This sends a request to stop the actual yt-dlp process and its FFmpeg child processes and removes the job-specific temporary files. A finished MP4 is not deleted.

## TikTok HTTP 403 (Forbidden)
403 is a platform-side denial, not a website syntax error. First update yt-dlp (`brew upgrade yt-dlp` if installed with Homebrew, or `python3 -m pip install -U yt-dlp` if installed with pip). Test `yt-dlp --verbose --skip-download "TIKTOK_URL"` directly. Check the link in your browser and the creator's download settings. Private/restricted videos may not work, and VidFlow does not bypass access restrictions.

If old UI still appears, stop the old server with Ctrl+C and hard-refresh the browser with Cmd+Shift+R.
