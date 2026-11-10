'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4317);
const OUT_DIR = path.join(os.homedir(), 'Downloads', 'VidFlow');
const jobs = new Map();
const videoInfoCache = new Map(); // In-memory preview results for this local-only app
const publicDir = path.join(__dirname, 'public');
const allowHosts = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com',
  'tiktok.com', 'instagram.com', 'facebook.com', 'fb.watch', 'fb.com'
];

function checkUrl(value) {
  if (typeof value !== 'string' || value.length > 2500) throw Error('Please enter a valid video URL.');
  let u;
  try { u = new URL(value.trim()); } catch { throw Error('Please enter a valid video URL.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw Error('Use an HTTPS video URL without credentials or custom ports.');
  const host = u.hostname.toLowerCase();
  if (!allowHosts.some(h => host === h || host.endsWith('.' + h))) throw Error('This version supports TikTok, Instagram, Facebook and YouTube links only.');
  return u.toString();
}
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 12000) throw Error('Request too large.');
  }
  try { return JSON.parse(data); } catch { throw Error('Invalid JSON.'); }
}
function available(cmd) {
  const r = spawnSync(cmd, [cmd === 'yt-dlp' ? '--version' : '-version'], { stdio: 'ignore', timeout: 5000 });
  return !r.error && r.status === 0;
}
function runCapture(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = '';
    const t = setTimeout(() => proc.kill('SIGTERM'), timeout);
    proc.stdout.on('data', d => { stdout += String(d); if (stdout.length > 4000000) proc.kill('SIGTERM'); });
    proc.stderr.on('data', d => { stderr = (stderr + String(d)).slice(-6000); });
    proc.on('error', err => { clearTimeout(t); reject(Error(err.code === 'ENOENT' ? 'yt-dlp is not installed. Install it with brew install yt-dlp.' : err.message)); });
    proc.on('close', code => {
      clearTimeout(t);
      if (code === 0) resolve(stdout);
      else reject(Error(platformError(stderr.split('\n').filter(Boolean).slice(-8).join(' ') || 'Could not retrieve video information.')));
    });
  });
}
function clean(text) { return String(text || '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 300); }
function safeError(err) { return clean(err.message || 'Something went wrong.'); }
function platformError(message) {
  const s = String(message || '');
  if (/HTTP Error 403|403: Forbidden/i.test(s)) return 'HTTP 403: The platform refused access to this video. This is not a VidFlow button error. Try updating yt-dlp, checking whether the video is accessible in your browser, or using the platform’s official download option. VidFlow cannot guarantee access to restricted videos.';
  if (/HTTP Error 429|Too Many Requests/i.test(s)) return 'The platform is rate-limiting requests (429). Try again later.';
  if (/private|login required|sign in to confirm|not available/i.test(s)) return 'This video may require access or may be unavailable. Use a video you can legitimately download.';
  return clean(s).slice(0, 500) || 'Download failed. See Terminal for details.';
}
function stopJobProcess(job) {
  if (!job.proc || !job.proc.pid) return;
  try { if (process.platform !== 'win32') process.kill(-job.proc.pid, 'SIGTERM'); else job.proc.kill('SIGTERM'); } catch { try { job.proc.kill('SIGTERM'); } catch {} }
  const force = setTimeout(() => {
    if (!job.exited) {
      try { if (process.platform !== 'win32') process.kill(-job.proc.pid, 'SIGKILL'); else job.proc.kill('SIGKILL'); } catch {}
    }
  }, 2500);
  force.unref();
}
function cleanJobTemp(job) {
  if (job.tempDir) fs.rm(job.tempDir, { recursive:true, force:true }, e => { if (e) console.error('Temp cleanup:', e.message); });
}
function staticFile(res, name, mime) {
  const p = path.join(publicDir, name);
  fs.readFile(p, (err, buf) => {
    if (err) return json(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(buf);
  });
}
function startDownload(url, quality) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const id = randomUUID();
  const job = { id, status: 'running', progress: 'Connecting to the video platform…', file: '', error: '', createdAt: Date.now(), proc: null, exited: false, tempDir: path.join(OUT_DIR, '.vidflow-work', id) };
  fs.mkdirSync(job.tempDir, {recursive:true});
  jobs.set(id, job);
  const args = [ '--ignore-config', '--no-playlist', '--no-overwrites', '--newline', '--no-warnings',
    '--paths', `home:${OUT_DIR}`, '--paths', `temp:${job.tempDir}`, '--progress', '-o', '%(title).90B [%(id)s].%(ext)s',
    '--print', 'after_move:VIDFLOW_FILE:%(filepath)s' ];
  // Exact selected height only. Prefer direct HTTPS MP4 for speed, then
  // fall back to available separate streams / segmented streams.
  const height = Number(quality);
  const selector = [
    `b[height=${height}][ext=mp4][protocol=https]`,
    `bv[height=${height}][ext=mp4][protocol=https]+ba[ext=m4a][protocol=https]`,
    `bv[height=${height}][protocol=https]+ba[protocol=https]`,
    `bv[height=${height}]+ba`,
    `b[height=${height}]`,
    `bv*[height=${height}]+ba`,
    `b[height=${height}][ext=mp4]`
  ].join('/');
  args.push('-f', selector, '--merge-output-format', 'mp4', '--remux-video', 'mp4', '-N', '8');
  args.push('--', url);
  const proc = spawn('yt-dlp', ['--verbose', '--socket-timeout', '12', '--retries', '2', '--extractor-retries', '2', ...args], { stdio: ['ignore','pipe','pipe'], detached: process.platform !== 'win32', env: {...process.env, PYTHONUNBUFFERED: '1'} });
  job.proc = proc;
  console.log(`[VidFlow ${id.slice(0,8)}] Started yt-dlp for ${new URL(url).hostname}`);
  let err = '';
  let stdoutBuf = '';
  let stderrBuf = '';
  let latestStage = 'Connecting to video platform';
  const beganAt = Date.now();
  const heartbeat = setInterval(() => {
    if (job.status !== 'running') return;
    const seconds = Math.floor((Date.now() - beganAt)/1000);
    if (!startedTransfer) job.progress = `${latestStage}… (${seconds}s elapsed)`;
    if (seconds % 10 === 0) console.log(`[VidFlow ${id.slice(0,8)}] ${job.progress}`);
  }, 1000);
  const stopHeartbeat = () => clearInterval(heartbeat);
  let startedTransfer = false;
  let finished = false;
  const startupTimer = setTimeout(() => {
    if (finished || startedTransfer || job.status !== 'running') return;
    job.status = 'failed';
    job.error = 'Video extraction took over 60 seconds without download progress. Check Terminal logs (VidFlow ID), test the URL directly in yt-dlp, or try another accessible video.';
    stopJobProcess(job);
  }, 60000);
  const processOutput = chunk => {
    stdoutBuf += String(chunk);
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop();
    lines.forEach(line => {
      if (line.trim()) console.log(`[yt-dlp ${id.slice(0,8)}] ${line.slice(0,320)}`);
      if (line.startsWith('VIDFLOW_FILE:')) job.file = line.substring('VIDFLOW_FILE:'.length).trim();
      else if (line.includes('[download]') || line.includes('[ExtractAudio]') || line.includes('[VideoRemuxer]') || line.includes('[Merger]')) {
        job.progress = clean(line.trim());
        if (line.includes('[download]') && /\d+(?:\.\d+)?%/.test(line)) startedTransfer = true;
      } else if (line.includes('[youtube]') || line.includes('[TikTok]') || line.includes('[Instagram]') || line.includes('[facebook]')) {
        latestStage = 'Fetching video information';
        job.progress = 'Fetching video information… ' + clean(line.trim()).slice(0, 150);
      }
    });
  };
  proc.stdout.on('data', processOutput);
  proc.stderr.on('data', d => {
    const txt = String(d);
    err = (err + txt).slice(-7000);
    stderrBuf += txt;
    const lines = stderrBuf.split(/\r?\n/);
    stderrBuf = lines.pop();
    for (const line of lines) {
      if (line.trim()) console.log(`[yt-dlp ${id.slice(0,8)}] ${line.slice(0,320)}`);
      if (/Downloading webpage|Downloading.*API|Downloading.*player|Solving JS|Downloading m3u8/i.test(line)) {latestStage = clean(line.replace(/^\[[^\]]+\]\s*/, '')).slice(0,110); job.progress = latestStage + '…';}
      if (/ERROR:|HTTP Error|Unable to|Sign in|login required|not available/i.test(line)) job.progress = 'Platform response: ' + clean(line).slice(0, 160);
    }
  });
  proc.on('error', e => { clearTimeout(startupTimer); stopHeartbeat(); if (job.status !== 'cancelled') { job.status = 'failed'; job.error = safeError(e); } cleanJobTemp(job); console.error(`[VidFlow ${id.slice(0,8)}] ${job.error}`); });
  proc.on('close', code => {
    finished = true; job.exited = true;
    clearTimeout(startupTimer); stopHeartbeat();
    if (stdoutBuf.trim()) processOutput('\n');
    if (stderrBuf.trim()) console.log(`[yt-dlp ${id.slice(0,8)}] ${stderrBuf.slice(0,320)}`);
    console.log(`[VidFlow ${id.slice(0,8)}] exit=${code} status=${job.status}`);
    if (job.status === 'cancelled' || job.status === 'failed') { cleanJobTemp(job); return; }
    if (code !== 0) { job.status = 'failed'; job.error = platformError(err.split('\n').filter(Boolean).slice(-8).join(' ')); }
    else if (!job.file || !fs.existsSync(job.file)) { job.status = 'failed'; job.error = 'Downloader exited without a confirmed saved MP4 file. Check Terminal logs.'; }
    else { job.status = 'done'; job.progress = 'Saved to Downloads/VidFlow'; }
    cleanJobTemp(job);
  });
  return job;
}
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [id, j] of jobs) if (j.createdAt < cutoff && j.status !== 'running') jobs.delete(id);
  for (const [url, entry] of videoInfoCache) if (entry.createdAt < cutoff) videoInfoCache.delete(url);
}, 600000).unref();
const files = { '/': ['index.html','text/html; charset=utf-8'], '/style.css': ['style.css','text/css; charset=utf-8'], '/app.js': ['app.js','text/javascript; charset=utf-8'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, `http://${HOST}`).pathname;
    if (req.method === 'GET' && files[pathname]) return staticFile(res, ...files[pathname]);
    if (req.method === 'GET' && pathname === '/api/status') return json(res, 200, { ytDlp: available('yt-dlp'), ffmpeg: available('ffmpeg'), folder: OUT_DIR });
    if (req.method === 'POST' && pathname === '/api/info') {
      const payload = await body(req), url = checkUrl(payload.url);
      const output = await runCapture(['--ignore-config','--no-playlist','--skip-download','--dump-single-json','--no-warnings','--',url], 40000);
      let video;
      try { video = JSON.parse(output); } catch { throw Error('Unable to read video information.'); }
      const qualities = [...new Set((video.formats || [])
        .filter(f => f && Number.isInteger(f.height) && f.height >= 144 && f.vcodec && f.vcodec !== 'none')
        .map(f => f.height))].sort((a,b) => b-a);
      // Some providers expose only a single video stream rather than a formats list.
      if (!qualities.length && Number.isInteger(video.height) && video.height >= 144) qualities.push(video.height);
      videoInfoCache.set(url, { qualities, createdAt: Date.now() });
      return json(res, 200, { title: clean(video.title), uploader: clean(video.uploader || video.channel), duration: video.duration || null, thumbnail: /^https:\/\//.test(video.thumbnail || '') ? video.thumbnail : '', platform: clean(video.extractor_key || video.extractor), id: clean(video.id), qualities });
    }
    if (req.method === 'POST' && pathname === '/api/download') {
      const payload = await body(req), url = checkUrl(payload.url);
      const info = videoInfoCache.get(url);
      if (!info || Date.now() - info.createdAt > 15 * 60 * 1000) throw Error('Click Check video first to refresh available qualities.');
      const quality = Number(payload.quality);
      if (!Number.isInteger(quality) || !info.qualities.includes(quality)) throw Error('This quality is not available for the selected video. Click Check video again.');
      if ([...jobs.values()].some(j => j.status === 'running' || (j.status === 'cancelled' && !j.exited))) return json(res, 429, {error:'A download is already running. Please finish it first.'});
      if (!available('yt-dlp')) throw Error('yt-dlp is missing. Run: brew install yt-dlp ffmpeg deno');
      if (!available('ffmpeg')) throw Error('FFmpeg is missing. Run: brew install ffmpeg');
      const job = startDownload(url, quality);
      return json(res, 202, { id: job.id });
    }
    if (req.method === 'POST' && /^\/api\/jobs\/[0-9a-f-]{36}\/cancel$/.test(pathname)) {
      const id = pathname.split('/')[3];
      const job = jobs.get(id);
      if (!job) return json(res, 404, {error:'Job not found.'});
      if (job.status === 'running') {
        job.status = 'cancelled'; job.progress = 'Download cancelled by user.';
        stopJobProcess(job);
        console.log(`[VidFlow ${id.slice(0,8)}] Cancel requested`);
      }
      return json(res, 200, {status:job.status, progress:job.progress});
    }
    if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
      const id = pathname.split('/').pop();
      if (!/^[0-9a-f-]{36}$/.test(id) || !jobs.has(id)) return json(res, 404, {error:'Job not found.'});
      const {status, progress, error, file} = jobs.get(id);
      return json(res, 200, {status,progress,error,file: file ? path.basename(file) : ''});
    }
    if (req.method === 'GET' && pathname === '/api/open-folder') {
      if (process.platform !== 'darwin') return json(res, 400, {error:'Open the Downloads/VidFlow folder on your computer.'});
      fs.mkdirSync(OUT_DIR, {recursive:true});
      const p = spawn('open', [OUT_DIR], {stdio:'ignore'});
      p.on('error', () => {});
      return json(res, 200, {ok:true});
    }
    return json(res, 404, {error:'Not found.'});
  } catch (err) { json(res, 400, {error:safeError(err)}); }
});
server.listen(PORT, HOST, () => console.log(`\nVidFlow running at http://${HOST}:${PORT}\nFiles save to: ${OUT_DIR}\nPress Ctrl+C to stop.\n`));
