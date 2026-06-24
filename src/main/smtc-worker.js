'use strict';

/* SMTC worker — AYRI bir Node sürecinde çalışır.
   Neden ayrı süreç? @coooookies/windows-smtc-monitor'ün WinRT tabanlı
   constructor'ı Electron ANA sürecinin mesaj döngüsünde kilitleniyor.
   Saf Node ortamında (ELECTRON_RUN_AS_NODE=1) ise sorunsuz çalışıyor.
   Bu yüzden nowPlaying.js bu betiği electron.exe'yi Node modunda fork ederek
   çalıştırır ve anlık görüntüleri IPC (process.send) ile alır.

   Albüm kapağı büyük olduğundan (~100KB) yalnızca şarkı kimliği değişince
   gönderilir; aksi halde sadece konum/durum güncellemesi geçer. */

let SMTCMonitor, PlaybackStatus;
try {
  ({ SMTCMonitor, PlaybackStatus } = require('@coooookies/windows-smtc-monitor'));
} catch (err) {
  send({ hasTrack: false, error: 'smtc-load:' + err.message });
  // Yüklenemezse boşta bekle (parent disconnect ile kapatır)
}

const PLAYING = (PlaybackStatus && PlaybackStatus.PLAYING != null) ? PlaybackStatus.PLAYING : 4;
const PAUSED = (PlaybackStatus && PlaybackStatus.PAUSED != null) ? PlaybackStatus.PAUSED : 5;

function send(obj) {
  try { process.send && process.send(obj); } catch {}
}

function sniffMime(buf) {
  if (!buf || buf.length < 4) return 'image/bmp';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp';
  return 'image/bmp';
}

function toMs(v) {
  if (v == null) return 0;
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return n > 10000 ? Math.round(n) : Math.round(n * 1000);
}

let lastKey = '';

function buildSnapshot() {
  if (!SMTCMonitor) return { hasTrack: false, error: 'smtc-unavailable' };
  let session = null;
  try {
    session = SMTCMonitor.getMediaSessionByAppId('Spotify.exe') || SMTCMonitor.getCurrentMediaSession();
  } catch (e) {
    return { hasTrack: false, error: 'snapshot:' + e.message };
  }
  if (!session || !session.media || !session.media.title) return { hasTrack: false };

  const m = session.media, p = session.playback || {}, t = session.timeline || {};
  const key = `${m.title}|${m.artist}|${m.albumTitle}`;
  const changed = key !== lastKey;
  lastKey = key;

  let albumArt = null;
  if (changed && m.thumbnail && m.thumbnail.length > 0) {
    albumArt = `data:${sniffMime(m.thumbnail)};base64,${Buffer.from(m.thumbnail).toString('base64')}`;
  }

  return {
    hasTrack: true,
    trackKey: key,
    trackChanged: changed,
    sourceAppId: session.sourceAppId || '',
    title: m.title || '',
    artist: m.artist || m.albumArtist || '',
    album: m.albumTitle || '',
    isPlaying: p.playbackStatus === PLAYING,
    isPaused: p.playbackStatus === PAUSED,
    positionMs: toMs(t.position),
    durationMs: toMs(t.duration),
    albumArt,                         // sadece şarkı değişince dolu
    hasThumb: !!(m.thumbnail && m.thumbnail.length > 0),
  };
}

function push() {
  send(buildSnapshot());
}

if (SMTCMonitor) {
  try {
    const monitor = new SMTCMonitor();
    for (const ev of ['session-media-changed', 'session-playback-changed',
      'current-session-changed', 'session-added', 'session-removed', 'session-timeline-changed']) {
      try { monitor.on(ev, () => push()); } catch {}
    }
  } catch (e) {
    send({ hasTrack: false, error: 'init:' + e.message });
  }
  const pollMs = Math.max(250, parseInt(process.env.SEFFAF_POLL_MS, 10) || 1000);
  setInterval(push, pollMs);
  push();
}

// Parent kapanınca biz de çıkalım
process.on('disconnect', () => process.exit(0));
process.on('message', (msg) => { if (msg === 'ping') push(); });
