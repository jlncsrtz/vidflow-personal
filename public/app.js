const $ = id => document.getElementById(id);
const notice = (message,type='') => { $('notice').textContent = message; $('notice').className = `notice ${type}`; };
async function api(path, opts) {
  const response = await fetch(path, opts);
  let data; try { data=await response.json(); } catch { throw Error('Server did not return a valid response.'); }
  if(!response.ok) throw Error(data.error||'Request failed.');
  return data;
}
function post(path, data) { return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }
function link() { const v=$('url').value.trim(); if(!v) throw Error('Paste a video link first.'); return v; }
let checkedUrl = '';
let loadingInfo = false;
let activeJobId = null;
let cancelling = false;
function resetQualities() {
  checkedUrl = '';
  $('quality').replaceChildren(new Option('Check video to load qualities…', ''));
  $('quality').disabled = true;
  $('video').classList.add('hidden');
  $('download').disabled = true;
}
function setBusy(on) {
  $('download').disabled = on || !checkedUrl || !$('quality').value;
  $('preview').disabled = on;
  $('url').disabled = on;
  $('download').textContent = on ? 'Downloading…' : '↓ Download MP4';
  $('cancel').classList.toggle('hidden', !on);
  $('cancel').disabled = !on || cancelling;
}
$('url').addEventListener('input', resetQualities);
$('paste').addEventListener('click', async()=>{
  try { $('url').value=await navigator.clipboard.readText(); resetQualities(); }
  catch { notice('Clipboard permission unavailable. Paste the link manually using Command + V.','error'); }
});
$('preview').addEventListener('click', async()=>{
  if(loadingInfo) return;
  loadingInfo=true;
  $('preview').disabled=true;
  resetQualities();
  notice('Checking video details and available qualities…');
  try {
    const url=link();
    const v=await post('/api/info',{url});
    if($('url').value.trim()!==url) { notice('Link changed. Check the new link again.'); return; }
    $('title').textContent=v.title||'Untitled video';
    $('uploader').textContent=[v.platform,v.uploader].filter(Boolean).join(' · ');
    $('thumb').style.display=v.thumbnail?'block':'none';
    if(v.thumbnail) $('thumb').src=v.thumbnail;
    $('video').classList.remove('hidden');
    const qualities=Array.isArray(v.qualities)?v.qualities:[];
    if (!qualities.length) { notice('Video found, but no downloadable video resolutions were reported for this link.','error'); return; }
    $('quality').replaceChildren(...qualities.map(q=>new Option(`${q}p · MP4`,String(q))));
    $('quality').disabled=false;
    checkedUrl=url;
    $('download').disabled=false;
    notice('Available qualities: '+qualities.map(q=>q+'p').join(', ')+'. Select one and click Download MP4.');
  } catch(e) { notice(e.message,'error'); }
  finally { loadingInfo=false; $('preview').disabled=false; }
});
$('cancel').addEventListener('click', async () => {
  if (!activeJobId || cancelling) return;
  cancelling = true;
  $('cancel').disabled = true;
  notice('Stopping download and cleaning partial files…');
  try {
    const j = await post('/api/jobs/' + encodeURIComponent(activeJobId) + '/cancel', {});
    if (j.status === 'cancelled') notice('Download cancelled.');
    else notice('Job already finished: ' + j.status);
  } catch (e) { notice('Cancel request failed: ' + e.message, 'error'); cancelling = false; $('cancel').disabled = false; }
});
$('form').addEventListener('submit', async e=>{
  e.preventDefault();
  if(!checkedUrl || checkedUrl!==$('url').value.trim()) { notice('Check the video and available qualities first.','error'); return; }
  cancelling = false;
  setBusy(true);
  try {
    const j=await post('/api/download',{url:checkedUrl,quality:$('quality').value});
    activeJobId=j.id;
    notice('Starting MP4 download…');
    while(true) {
      await new Promise(r=>setTimeout(r,850));
      const status=await api('/api/jobs/'+encodeURIComponent(j.id));
      if(status.status==='done') { notice('✓ MP4 saved to Downloads/VidFlow'+(status.file?' — '+status.file:''),'success'); break; }
      if(status.status==='failed') throw Error(status.error||'Download failed.');
      if(status.status==='cancelled') { notice('Download cancelled.'); break; }
      notice(status.progress||'Downloading MP4…');
    }
  } catch(e) { notice(e.message,'error'); }
  finally { activeJobId = null; cancelling = false; setBusy(false); }
});
$('openFolder').addEventListener('click',async()=>{try{await api('/api/open-folder');}catch(e){notice(e.message,'error');}});
resetQualities();
(async()=>{try{let s=await api('/api/status');if(!s.ytDlp||!s.ffmpeg)notice('Missing tools: '+[!s.ytDlp?'yt-dlp':null,!s.ffmpeg?'FFmpeg':null].filter(Boolean).join(', ')+'. Install with: brew install yt-dlp ffmpeg deno','error');}catch{notice('Unable to connect to the local server.','error');}})();
