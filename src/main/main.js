'use strict';

const {
  app, BrowserWindow, ipcMain, globalShortcut, screen,
  Tray, Menu, nativeImage, shell, dialog,
} = require('electron');
const path = require('node:path');

const fs = require('node:fs');
const os = require('node:os');

const store = require('./store');
const nowPlaying = require('./nowPlaying');
const apo = require('./apoController');
const mediaControl = require('./mediaControl');
const volumeControl = require('./volumeControl');

/* ---- Hata günlüğü (sorun tespiti için) ---- */
const ERR_LOG = path.join(os.tmpdir(), 'seffaf-error.log');
function logErr(tag, msg) {
  try { fs.appendFileSync(ERR_LOG, `[${new Date().toISOString()}] ${tag}: ${msg}\n`); } catch {}
}
process.on('uncaughtException', (e) => logErr('uncaughtException', (e && e.stack) || String(e)));
process.on('unhandledRejection', (e) => logErr('unhandledRejection', (e && e.stack) || String(e)));

/* Pencere render hatalarını günlüğe yaz */
function attachDiag(win, name) {
  const wc = win.webContents;
  wc.on('render-process-gone', (_e, d) => logErr(`${name}:render-gone`, JSON.stringify(d)));
  wc.on('preload-error', (_e, p, err) => logErr(`${name}:preload-error`, (err && err.stack) || String(err)));
  wc.on('console-message', (_e, level, message, line, src) => {
    if (level >= 2) logErr(`${name}:console`, `${message} (${src}:${line})`); // 2=warning,3=error
  });
  wc.on('did-fail-load', (_e, code, desc) => logErr(`${name}:load-fail`, `${code} ${desc}`));
}

/* ---- Şeffaflık / GPU bayrakları (app hazır olmadan ÖNCE) ---- */
app.commandLine.appendSwitch('enable-transparent-visuals');

const isDev = process.argv.includes('--dev');
const ASSET = (f) => path.join(__dirname, '..', '..', 'assets', f);
const RENDERER = (f) => path.join(__dirname, '..', 'renderer', f);
const PRELOAD = (f) => path.join(__dirname, '..', 'preload', f);

// Overlay taban boyutu (ölçek 1.0 iken). Pencere = TABAN * scale.
const BASE_W = 372, BASE_H = 134;
const SNAP = 16;            // kenara yapışma eşiği (px)
const MIN_SCALE = 0.7, MAX_SCALE = 1.8;

let overlayWin = null;
let settingsWin = null;
let tray = null;
let stopMonitor = null;
let lastTrack = { hasTrack: false };

/* Tek örnek (single instance) — SEFFAF_NO_SINGLE_INSTANCE ile atlanabilir (teşhis) */
const gotLock = process.env.SEFFAF_NO_SINGLE_INSTANCE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // İkinci kez açılınca overlay'i görünür yap (gizliyse geri getir) ve ayarları aç
    toggleOverlayVisible(true);
    openSettings();
  });
}

/* ============================ Overlay penceresi ============================ */
function clampToDisplay(b) {
  if (b.x == null || b.y == null) return b;
  try {
    const display = screen.getDisplayMatching({ x: b.x, y: b.y, width: b.width, height: b.height });
    const wa = display.workArea;
    const width = Math.min(b.width, wa.width);
    const height = Math.min(b.height, wa.height);
    const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width);
    const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height);
    return { x, y, width, height };
  } catch {
    return b;
  }
}

function createOverlay() {
  const ov = store.get('overlay');
  const scale = ov.scale || 1;
  let bounds = {
    width: Math.round(BASE_W * scale),
    height: Math.round(BASE_H * scale),
    x: ov.x,
    y: ov.y,
  };

  // İlk açılışta sağ üst köşe
  if (bounds.x == null || bounds.y == null) {
    const wa = screen.getPrimaryDisplay().workArea;
    bounds.x = wa.x + wa.width - bounds.width - 24;
    bounds.y = wa.y + 24;
  }
  bounds = clampToDisplay(bounds);

  overlayWin = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 240,
    minHeight: 90,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    thickFrame: false,
    // roundedCorners DWM tarafında ayrı bir köşe çiziyor ve CSS yuvarlağıyla
    // çakışıp "iki katmanlı" sivri köşe görüntüsü veriyor. CSS'e bırakıyoruz.
    roundedCorners: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    webPreferences: {
      preload: PRELOAD('overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  overlayWin.setAlwaysOnTop(true, 'screen-saver', 1);
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  attachDiag(overlayWin, 'overlay');
  overlayWin.loadFile(RENDERER('overlay.html'));

  overlayWin.once('ready-to-show', () => {
    if (store.get('overlay.visible') !== false) overlayWin.show();
    pushSettingsToOverlay();
    pushTrack(lastTrack);
  });

  // Pozisyonu kaydet
  const saveBounds = () => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    const b = overlayWin.getBounds();
    store.merge('overlay', { x: b.x, y: b.y, width: b.width, height: b.height });
  };
  overlayWin.on('moved', saveBounds);
  overlayWin.on('close', saveBounds);
  overlayWin.on('closed', () => { overlayWin = null; });

  if (isDev) overlayWin.webContents.openDevTools({ mode: 'detach' });
}

function pushSettingsToOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send('overlay:settings', store.get('overlay'));
  }
}

function pushTrack(track) {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send('track:update', track);
  }
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('track:update', track);
  }
}

function setOverlayLocked(locked) {
  store.set('overlay.locked', locked);
  pushSettingsToOverlay();
  updateTrayMenu();
}

function toggleOverlayVisible(force) {
  const visible = force != null ? force : !(store.get('overlay.visible') !== false);
  store.set('overlay.visible', visible);
  if (overlayWin && !overlayWin.isDestroyed()) {
    visible ? overlayWin.show() : overlayWin.hide();
  } else if (visible) {
    createOverlay();
  }
  updateTrayMenu();
}

/* ---- Manuel sürükleme (kenara yapışmalı) ---- */
let savePosT = null;
function savePosDebounced(x, y) {
  clearTimeout(savePosT);
  savePosT = setTimeout(() => {
    // Pencere yok edilmişse eski konumu yazma
    if (overlayWin && !overlayWin.isDestroyed()) store.merge('overlay', { x, y });
  }, 400);
}
function moveOverlayTo(x, y) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const b = overlayWin.getBounds();
  let nx = Math.round(x), ny = Math.round(y);
  try {
    const wa = screen.getDisplayMatching({ x: nx, y: ny, width: b.width, height: b.height }).workArea;
    if (Math.abs(nx - wa.x) < SNAP) nx = wa.x;
    if (Math.abs((nx + b.width) - (wa.x + wa.width)) < SNAP) nx = wa.x + wa.width - b.width;
    if (Math.abs(ny - wa.y) < SNAP) ny = wa.y;
    if (Math.abs((ny + b.height) - (wa.y + wa.height)) < SNAP) ny = wa.y + wa.height - b.height;
  } catch {}
  overlayWin.setPosition(nx, ny);
  savePosDebounced(nx, ny);
}

/* ---- Ölçek (pencere boyutu = TABAN * scale) ---- */
function applyOverlaySize() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const scale = store.get('overlay.scale') || 1;
  overlayWin.setSize(Math.round(BASE_W * scale), Math.round(BASE_H * scale));
}
function setOverlayScale(scale) {
  scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(scale * 100) / 100));
  store.set('overlay.scale', scale);
  applyOverlaySize();
  pushSettingsToOverlay();
}

/* ---- Overlay sağ tık menüsü ---- */
function popupOverlayMenu() {
  const locked = !!store.get('overlay.locked');
  const menu = Menu.buildFromTemplate([
    { label: lastTrack.hasTrack ? `🎵 ${lastTrack.title}` : 'Spotify çalmıyor', enabled: false },
    { type: 'separator' },
    { label: locked ? 'Kilidi Aç' : 'Kilitle', click: () => setOverlayLocked(!locked) },
    { label: 'Ayarlar / Ses & EQ…', click: openSettings },
    { label: 'Sağ üste taşı', click: resetOverlayPosition },
    { type: 'separator' },
    { label: 'Gizle', click: () => toggleOverlayVisible(false) },
    { label: 'Çıkış', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  if (overlayWin && !overlayWin.isDestroyed()) menu.popup({ window: overlayWin });
}

/* ============================ Ayarlar penceresi ============================ */
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 470,
    height: 600,
    minWidth: 430,
    minHeight: 520,
    title: 'Spotify Şeffaf Overlay — Ayarlar',
    backgroundColor: '#0d0d11',
    resizable: false,
    maximizable: false,
    icon: ASSET('icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD('settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWin.removeMenu();
  attachDiag(settingsWin, 'settings');
  settingsWin.loadFile(RENDERER('settings.html'));
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    settingsWin.webContents.send('track:update', lastTrack);
  });
  settingsWin.on('closed', () => { settingsWin = null; });
  if (isDev) settingsWin.webContents.openDevTools({ mode: 'detach' });
}

/* ============================ Tray ============================ */
function buildTrayImage() {
  let img = nativeImage.createFromPath(ASSET('tray.png'));
  if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 });
  return img;
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = store.get('overlay.visible') !== false;
  const locked = !!store.get('overlay.locked');
  const audioEnabled = !!store.get('audio.enabled');

  const menu = Menu.buildFromTemplate([
    { label: lastTrack.hasTrack ? `🎵 ${lastTrack.title} — ${lastTrack.artist}` : 'Spotify çalmıyor', enabled: false },
    { type: 'separator' },
    { label: visible ? 'Overlay\'i Gizle' : 'Overlay\'i Göster', click: () => toggleOverlayVisible() },
    {
      label: locked ? 'Kilidi Aç (sürüklenebilir)' : 'Kilitle (tıklama geçer)',
      click: () => setOverlayLocked(!locked),
    },
    { label: 'Overlay\'i Sağ Üste Taşı', click: resetOverlayPosition },
    { type: 'separator' },
    { label: audioEnabled ? '🔊 Ses Boost: AÇIK' : '🔈 Ses Boost: kapalı', enabled: false },
    { label: 'Ayarlar / Ses & EQ…', click: openSettings },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(lastTrack.hasTrack
    ? `${lastTrack.title} — ${lastTrack.artist}`
    : 'Spotify Şeffaf Overlay');
}

function resetOverlayPosition() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const b = overlayWin.getBounds();
  const x = wa.x + wa.width - b.width - 24;
  const y = wa.y + 24;
  overlayWin.setPosition(x, y);
  store.merge('overlay', { x, y });
}

function createTray() {
  tray = new Tray(buildTrayImage());
  updateTrayMenu();
  tray.on('double-click', openSettings);
}

/* ============================ APO ses uygulama ============================ */
function applyAudio() {
  const audio = store.get('audio');
  const info = apo.detect();
  if (!info.installed) return { ok: false, reason: 'not-installed' };
  if (!info.ready) return { ok: false, reason: 'not-setup' };
  const res = apo.writeEq(audio);
  return res;
}

/* ============================ IPC ============================ */
function registerIpc() {
  // -- Overlay --
  ipcMain.on('overlay:request-initial', () => { pushSettingsToOverlay(); pushTrack(lastTrack); });
  ipcMain.on('overlay:toggle-lock', () => setOverlayLocked(!store.get('overlay.locked')));
  ipcMain.on('overlay:open-settings', openSettings);
  ipcMain.on('overlay:hide', () => toggleOverlayVisible(false));
  ipcMain.on('overlay:set-ignore-mouse', (e, ignore, options) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && !w.isDestroyed()) w.setIgnoreMouseEvents(ignore, options);
  });

  // -- Manuel sürükleme / boyutlandırma / sağ tık --
  ipcMain.handle('overlay:get-bounds', () => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      const b = overlayWin.getBounds();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }
    return { x: 0, y: 0, width: BASE_W, height: BASE_H };
  });
  ipcMain.on('overlay:move-to', (e, x, y) => moveOverlayTo(x, y));
  ipcMain.on('overlay:set-scale', (e, scale) => setOverlayScale(scale));
  ipcMain.on('overlay:context-menu', popupOverlayMenu);

  // -- Medya kontrolü (oynat/duraklat/sonraki/önceki/karıştır/tekrarla/sarma) --
  ipcMain.handle('media:control', async (e, cmd, positionMs) => {
    const res = await mediaControl.control(cmd, positionMs);
    // Komuttan sonra worker'ı dürtüp UI'yi hızla tazele
    setTimeout(() => nowPlaying.refresh(), 150);
    setTimeout(() => nowPlaying.refresh(), 500);
    return res;
  });

  // -- Spotify oturum sesi (get/set/mute/unmute) --
  // SMTC volume desteklemediği için ayrı ISimpleAudioVolume backend'i.
  // Seviye store'a kaydedilir; Spotify yeniden açılınca otomatik restore edilir.
  ipcMain.handle('media:volume', async (e, cmd, level) => {
    const res = await volumeControl.control(cmd, level);
    if (res && res.ok) {
      const v = store.get('volume');
      if (res.level != null) v.level = res.level;
      if (res.muted != null) {
        v.muted = !!res.muted;
        if (res.muted && v.level > 0) v.lastLevel = v.level;
      }
      store.set('volume', v);
    }
    return res;
  });

  // -- Ayarlar penceresi --
  ipcMain.handle('settings:get', () => ({
    overlay: store.get('overlay'),
    audio: store.get('audio'),
    general: store.get('general'),
    apo: apo.detect(),
    presets: Object.fromEntries(Object.entries(apo.PRESETS).map(([k, v]) => [k, v.label])),
    hardCap: apo.HARD_CAP_DB,
  }));

  ipcMain.handle('settings:set-overlay', (e, patch) => {
    store.merge('overlay', patch);
    // Görünürlük değiştiyse pencereyi gerçekten göster/gizle
    if (Object.prototype.hasOwnProperty.call(patch, 'visible')) {
      toggleOverlayVisible(patch.visible !== false);
    }
    // Ölçek değiştiyse pencereyi yeniden boyutlandır (içerik kırpılmasın)
    if (Object.prototype.hasOwnProperty.call(patch, 'scale')) {
      applyOverlaySize();
    }
    pushSettingsToOverlay();
    updateTrayMenu();
    return store.get('overlay');
  });

  ipcMain.handle('overlay:reset-position', () => { resetOverlayPosition(); return store.get('overlay'); });

  ipcMain.handle('settings:set-audio', (e, patch) => {
    store.merge('audio', patch);
    const res = applyAudio();
    updateTrayMenu();
    return { audio: store.get('audio'), apply: res };
  });

  ipcMain.handle('settings:set-general', (e, patch) => {
    store.merge('general', patch);
    if (patch.launchOnStartup != null) {
      // Paketli (portable/NSIS) exe'de doğru yürütülebilir + argüman ver
      app.setLoginItemSettings({
        openAtLogin: !!patch.launchOnStartup,
        path: process.execPath,
        args: [],
      });
    }
    return store.get('general');
  });

  // -- APO işlemleri --
  ipcMain.handle('apo:detect', () => apo.detect());
  ipcMain.handle('apo:setup', async (e, opts) => {
    const res = await apo.runSetup(opts || {});
    if (res.ok) {
      // Kurulumdan sonra mevcut ayarı yaz
      store.set('audio.enabled', true);
      applyAudio();
    }
    updateTrayMenu();
    return { setup: res, apo: apo.detect() };
  });
  ipcMain.handle('apo:open-download', () => { shell.openExternal(apo.DOWNLOAD_URL); return true; });
  ipcMain.handle('apo:open-configurator', () => {
    const info = apo.detect();
    if (info.configurator) { shell.openPath(info.configurator); return true; }
    return false;
  });
}

/* ============================ Şarkı izleme ============================ */
function startTracking() {
  const interval = store.get('general.pollIntervalMs') || 1000;
  const fallback = store.get('general.albumArtSource') !== 'smtc-only';
  stopMonitor = nowPlaying.startMonitor((snap) => {
    lastTrack = snap;
    pushTrack(snap);
    updateTrayMenu();
  }, { pollIntervalMs: interval, albumArtFallback: fallback });
}

/* ============================ Kısayollar ============================ */
async function adjustVolume(delta) {
  const v = store.get('volume') || { level: 1.0, muted: false, lastLevel: 1.0 };
  
  if (v.muted) {
    v.muted = false;
    await volumeControl.control('unmute');
  }
  
  let newLevel = (v.level || 0) + delta;
  newLevel = Math.max(0, Math.min(1, Math.round(newLevel * 100) / 100));
  
  const res = await volumeControl.control('set', newLevel);
  if (res && res.ok) {
    v.level = newLevel;
    store.set('volume', v);
    pushVolume({ level: newLevel, muted: false });
  }
}

async function toggleMute() {
  const v = store.get('volume') || { level: 1.0, muted: false, lastLevel: 1.0 };
  const targetMuted = !v.muted;
  const cmd = targetMuted ? 'mute' : 'unmute';
  const res = await volumeControl.control(cmd);
  if (res && res.ok) {
    v.muted = targetMuted;
    if (targetMuted && v.level > 0) v.lastLevel = v.level;
    
    if (!targetMuted && v.lastLevel > 0 && v.lastLevel !== v.level) {
      v.level = v.lastLevel;
      await volumeControl.control('set', v.level);
    }
    
    store.set('volume', v);
    pushVolume({ level: v.level, muted: targetMuted });
  }
}

function pushVolume(volState) {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send('volume:update', volState);
  }
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+L', () => setOverlayLocked(!store.get('overlay.locked')));
  globalShortcut.register('CommandOrControl+Shift+O', () => toggleOverlayVisible());
  globalShortcut.register('CommandOrControl+Shift+Up', () => adjustVolume(0.05));
  globalShortcut.register('CommandOrControl+Shift+Down', () => adjustVolume(-0.05));
  globalShortcut.register('CommandOrControl+Shift+M', () => toggleMute());
}

/* ============================ Spotify sesi ============================ */
/* Spotify (yeniden) açıldığında kaydedilen son ses seviyesini geri yükle.
   ISimpleAudioVolume session bazlıdır; Spotify kapanıp açılınca seviye
   sıfırlanabilir — bunu periyodik olarak düzeltiriz. */
let restoreVolumeT = null;
function scheduleVolumeRestore() {
  if (restoreVolumeT) return;
  restoreVolumeT = setInterval(tryRestoreVolume, 5000);
}
let lastRestoredKey = null;
async function tryRestoreVolume() {
  if (!lastTrack || !lastTrack.hasTrack) return;   // Spotify çalmıyorsa dokunma
  const v = store.get('volume');
  if (!v) return;
  // Mevcut durumu oku, kaydedilenle fark varsa düzelt
  const cur = await volumeControl.control('get');
  if (!cur || !cur.ok) { lastRestoredKey = null; return; }
  const key = `${cur.level}|${cur.muted}`;
  if (Math.abs((cur.level || 0) - v.level) < 0.01 && !!cur.muted === !!v.muted) {
    lastRestoredKey = key;   // zaten senkron
    return;
  }
  // Spotify tarafını store'a eşitle
  if (v.muted) await volumeControl.control('mute');
  else await volumeControl.control('set', v.level);
  lastRestoredKey = key;
}

/* ============================ App yaşam döngüsü ============================ */
app.whenReady().then(() => {
  registerIpc();
  createOverlay();
  createTray();
  startTracking();
  registerShortcuts();
  scheduleVolumeRestore();

  // SMTC yoksa uyarı
  if (!nowPlaying.isAvailable()) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'SMTC kullanılamıyor',
      message: 'Windows medya bilgisi okunamadı. Windows 10 1809+ gerekir ve Spotify masaüstü uygulamasının açık olması gerekir.',
    });
  }

  // İlk çalıştırmada ayarları aç
  if (!store.get('general.firstRunDone')) {
    store.set('general.firstRunDone', true);
    setTimeout(openSettings, 600);
  }

  app.on('activate', () => { if (!overlayWin) createOverlay(); });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { stopMonitor && stopMonitor(); } catch {}
});

// Tray uygulaması: pencere kapansa da arka planda kalsın
app.on('window-all-closed', (e) => {
  // Overlay gizlenince/kapansa bile uygulama tray'de kalır; çıkış tray'den.
  if (!app.isQuitting) {
    // hiçbir şey yapma — tray'de yaşamaya devam
  } else if (process.platform !== 'darwin') {
    app.quit();
  }
});
