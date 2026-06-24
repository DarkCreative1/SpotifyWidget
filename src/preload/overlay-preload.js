'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/* Overlay penceresi için güvenli köprü.
   contextIsolation:true + nodeIntegration:false ile çalışır. */

contextBridge.exposeInMainWorld('overlayAPI', {
  // main -> renderer
  onTrack: (cb) => ipcRenderer.on('track:update', (_e, data) => cb(data)),
  onSettings: (cb) => ipcRenderer.on('overlay:settings', (_e, data) => cb(data)),
  onVolumeUpdate: (cb) => ipcRenderer.on('volume:update', (_e, data) => cb(data)),

  // renderer -> main
  requestInitial: () => ipcRenderer.send('overlay:request-initial'),
  toggleLock: () => ipcRenderer.send('overlay:toggle-lock'),
  openSettings: () => ipcRenderer.send('overlay:open-settings'),
  hide: () => ipcRenderer.send('overlay:hide'),

  // Hover tabanlı tıklama-geçirgenlik (boş alan arkaya tıklar, kart tıklanır kalır)
  setIgnoreMouse: (ignore, options) => ipcRenderer.send('overlay:set-ignore-mouse', ignore, options),

  // Medya kontrolü: cmd = play|pause|toggle|next|prev|stop|shuffle|repeat|seek
  control: (cmd, positionMs) => ipcRenderer.invoke('media:control', cmd, positionMs),

  // Spotify oturum sesi: cmd = get|set|mute|unmute (set icin level 0..1)
  volumeControl: (cmd, level) => ipcRenderer.invoke('media:volume', cmd, level),

  // Manuel sürükleme + boyutlandırma + sağ tık menüsü
  getBounds: () => ipcRenderer.invoke('overlay:get-bounds'),
  moveTo: (x, y) => ipcRenderer.send('overlay:move-to', x, y),
  setScale: (scale) => ipcRenderer.send('overlay:set-scale', scale),
  contextMenu: () => ipcRenderer.send('overlay:context-menu'),
});
