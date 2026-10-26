'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('host', {
  onCommand: on('capri:command'),
  onConfig: on('capri:config'),
  onResize: on('overlay:resize'),
  onWindows: on('windows:update'),
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', Boolean(on)),
  setHitRects: (rects) => ipcRenderer.send('overlay:set-shape', rects),
  cursor: () => ipcRenderer.invoke('overlay:cursor'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  openMenu: () => ipcRenderer.send('menu:open'),
  windowsNow: () => ipcRenderer.invoke('windows:get'),
});
