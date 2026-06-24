'use strict';

/* Çalan şarkıyı SMTC'den okur. Native modülün WinRT constructor'ı Electron
   ana sürecinde kilitlendiği için okuma AYRI bir Node sürecinde yapılır
   (electron.exe, ELECTRON_RUN_AS_NODE=1 ile saf Node olarak fork edilir).
   Bu yaklaşım paketlenmiş uygulamada da çalışır (sistem Node'u gerekmez).

   - Worker çökerse otomatik (backoff'lu) yeniden başlatılır.
   - Spotify kapak vermezse iTunes Search API'den yedek kapak çekilir.
   - Reklam/şarkı geçişinde kısa "boş" anlar overlay'i silmemesi için grace. */

const path = require('node:path');
const { fork } = require('node:child_process');

const WORKER = path.join(__dirname, 'smtc-worker.js');
const NEG_TTL = 60 * 60 * 1000;   // iTunes "kapak yok" sonucunu 1 saat önbellekle

let child = null;
let latest = { hasTrack: false };
let lastArt = null;
let lastArtKey = '';
let lastGood = null;              // son geçerli (hasTrack) anlık görüntü
let falseStreak = 0;             // ardışık "boş" snapshot sayısı
let available = process.platform === 'win32';
let stopped = false;
let backoff = 1000;

/* iTunes yedeği — sadece SMTC kapak vermediğinde. */
const itunesCache = new Map();   // key -> { art, ts }
async function fetchItunesArt(artist, title) {
  const key = `${artist}|${title}`.toLowerCase();
  const cached = itunesCache.get(key);
  if (cached && (cached.art || Date.now() - cached.ts < NEG_TTL)) return cached.art;
  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`;
    const res = await fetch(url);
    const json = await res.json();
    const hit = json.results && json.results[0];
    const art = (hit && hit.artworkUrl100) ? hit.artworkUrl100.replace('100x100bb', '600x600bb') : null;
    itunesCache.set(key, { art, ts: Date.now() });
    return art;
  } catch {
    return null;
  }
}

function getSnapshot() {
  return latest;
}

/* Worker'a anlık güncelleme için dürtü gönder (kontrol komutundan sonra). */
function refresh() {
  try { if (child && child.connected) child.send('ping'); } catch {}
}

function startMonitor(onUpdate, opts = {}) {
  const fallback = opts.albumArtFallback !== false;
  const pollMs = opts.pollIntervalMs || 1000;
  const graceTicks = Math.max(2, Math.round(2500 / pollMs)); // ~2.5sn boş'a tolerans

  stopped = false;
  backoff = 1000;

  const handle = async (snap) => {
    backoff = 1000; // sağlıklı mesaj geldi → backoff sıfırla

    if (!snap || !snap.hasTrack) {
      falseStreak++;
      // Reklam/geçiş gibi kısa boşluklarda son şarkıyı koru, hemen silme
      if (lastGood && falseStreak < graceTicks) return;
      lastGood = null;
      latest = snap || { hasTrack: false };
      onUpdate(latest);
      return;
    }

    falseStreak = 0;

    // Albüm kapağı yönetimi: worker sadece şarkı değişince kapak gönderir.
    if (snap.albumArt) {
      lastArt = snap.albumArt;
      lastArtKey = snap.trackKey;
    } else if (snap.trackKey === lastArtKey && lastArt) {
      snap.albumArt = lastArt;          // aynı şarkı → önbellekteki kapağı kullan
    } else if (snap.trackChanged && !snap.hasThumb && fallback) {
      const art = await fetchItunesArt(snap.artist, snap.title);
      if (art) { snap.albumArt = art; lastArt = art; lastArtKey = snap.trackKey; }
    }

    lastGood = snap;
    latest = snap;
    onUpdate(snap);
  };

  const spawnWorker = () => {
    child = fork(WORKER, [], {
      execPath: process.execPath,                       // electron.exe
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SEFFAF_POLL_MS: String(pollMs) },
      cwd: path.join(__dirname, '..', '..'),            // node_modules çözümü için kök
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    });
    available = process.platform === 'win32';           // (yeniden) başlatınca toparlan
    child.on('message', handle);
    child.on('error', (err) => {
      console.error('[nowPlaying] worker hatası:', err.message);
    });
    child.on('exit', (code) => {
      console.warn('[nowPlaying] worker çıktı, kod:', code);
      child = null;
      if (stopped) return;
      const delay = backoff;
      backoff = Math.min(backoff * 2, 30000);           // 1s,2s,4s… max 30s
      setTimeout(() => {
        if (stopped) return;
        try { spawnWorker(); }
        catch (e) { console.error('[nowPlaying] respawn hata:', e.message); }
      }, delay);
    });
  };

  try {
    spawnWorker();
  } catch (err) {
    console.error('[nowPlaying] worker başlatılamadı:', err.message);
    available = false;
    latest = { hasTrack: false, error: 'spawn:' + err.message };
    onUpdate(latest);
  }

  return () => {
    stopped = true;
    try { if (child) child.kill(); } catch {}
    child = null;
  };
}

module.exports = {
  getSnapshot,
  startMonitor,
  refresh,
  fetchItunesArt,
  isAvailable: () => available,
};
