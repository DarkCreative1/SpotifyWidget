'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setOverlay: (patch) => ipcRenderer.invoke('settings:set-overlay', patch),
  resetPosition: () => ipcRenderer.invoke('overlay:reset-position'),
  setAudio: (patch) => ipcRenderer.invoke('settings:set-audio', patch),
  setGeneral: (patch) => ipcRenderer.invoke('settings:set-general', patch),

  apoDetect: () => ipcRenderer.invoke('apo:detect'),
  apoSetup: (opts) => ipcRenderer.invoke('apo:setup', opts),
  apoOpenDownload: () => ipcRenderer.invoke('apo:open-download'),
  apoOpenConfigurator: () => ipcRenderer.invoke('apo:open-configurator'),

  onTrack: (cb) => ipcRenderer.on('track:update', (_e, data) => cb(data)),
});
