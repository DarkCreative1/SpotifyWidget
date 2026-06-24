'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Basit, bağımlılıksız JSON ayar deposu.
 * electron-store v11 ESM-only olduğu için onun yerine bunu kullanıyoruz.
 * Ayarlar userData klasöründe settings.json olarak tutulur.
 */

const DEFAULTS = {
  // Overlay penceresi
  overlay: {
    x: null,            // null => ilk açılışta sağ-üst köşe
    y: null,
    width: 372,
    height: 134,
    locked: false,      // kilitliyse sürüklenemez + tıklama-geçirgen
    opacity: 1,         // 0.2 - 1
    scale: 1,           // 0.7 - 1.6 arası UI ölçeği
    showProgress: true,
    showAlbumArt: true,
    theme: 'auto',      // auto | dark | light | albumglow
    visible: true,
  },
  // Ses / Equalizer APO
  audio: {
    boostDb: 0,         // 0 - 12 dB preamp boost
    enabled: false,     // APO entegrasyonu aktif mi
    preset: 'flat',     // flat | bass | vocal | treble | loudness | custom
    customBands: null,  // custom GraphicEQ için { freq: gainDb }
  },
  // Spotify oturum sesi (overlay'deki hoparlör butonu)
  // SMTC volume desteklemediği için ayrı ISimpleAudioVolume backend'i kullanılır.
  volume: {
    level: 1,           // 0 - 1 (son uygulanan seviye)
    muted: false,       // sessize alındı mı
    lastLevel: 1,       // mute öncesi son seviye (unmute'da geri yükle)
  },
  // Genel
  general: {
    launchOnStartup: false,
    pollIntervalMs: 1000,
    albumArtSource: 'smtc', // smtc | itunes (kapak gelmezse yedek)
    firstRunDone: false,
  },
};

let cachePath = null;
let data = null;

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (override && typeof override === 'object' && !Array.isArray(override)) {
    for (const key of Object.keys(override)) {
      const bv = base ? base[key] : undefined;
      const ov = override[key];
      if (bv && typeof bv === 'object' && !Array.isArray(bv) &&
          ov && typeof ov === 'object' && !Array.isArray(ov)) {
        out[key] = deepMerge(bv, ov);
      } else if (ov !== undefined) {
        out[key] = ov;
      }
    }
  }
  return out;
}

function filePath() {
  if (!cachePath) {
    cachePath = path.join(app.getPath('userData'), 'settings.json');
  }
  return cachePath;
}

function load() {
  if (data) return data;
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    const parsed = JSON.parse(raw);
    data = deepMerge(DEFAULTS, parsed);
  } catch {
    data = deepMerge(DEFAULTS, {});
  }
  return data;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[store] kaydedilemedi:', err.message);
  }
}

/** Nokta yoluyla değer al: get('overlay.x') */
function get(keyPath, fallback) {
  load();
  if (!keyPath) return data;
  const parts = keyPath.split('.');
  let cur = data;
  for (const p of parts) {
    if (cur == null) return fallback;
    cur = cur[p];
  }
  return cur === undefined ? fallback : cur;
}

/** Nokta yoluyla değer yaz: set('overlay.x', 100) */
function set(keyPath, value) {
  load();
  const parts = keyPath.split('.');
  let cur = data;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] == null) {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  save();
  return value;
}

/** Bir objeyi belirli yola merge et: merge('overlay', {x:1,y:2}) */
function merge(keyPath, partial) {
  const current = get(keyPath, {});
  const merged = deepMerge(current && typeof current === 'object' ? current : {}, partial);
  return set(keyPath, merged);
}

module.exports = { get, set, merge, save, DEFAULTS };
