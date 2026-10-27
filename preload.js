'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('keyboardDriver', {
  inspect: () => ipcRenderer.invoke('keyboard:inspect'),
  getLighting: () => ipcRenderer.invoke('lighting:get'),
  applyLighting: (channel, setting) => ipcRenderer.invoke('lighting:apply', channel, setting),
  restoreLighting: () => ipcRenderer.invoke('lighting:restore'),
  getKeymap: () => ipcRenderer.invoke('keymap:get'),
  applyKeymap: (layer, physicalIndex, targetHid) => ipcRenderer.invoke('keymap:apply', layer, physicalIndex, targetHid),
  restoreKeymap: () => ipcRenderer.invoke('keymap:restore')
});

