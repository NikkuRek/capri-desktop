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
  toggleCompact: () => ipcRenderer.invoke('window:toggle-compact'),
  toggleVisible: () => ipcRenderer.invoke('window:toggle-visible'),
  windowsNow: () => ipcRenderer.invoke('windows:get'),
  listCommands: () => ipcRenderer.invoke('commands:list'),
  runCommand: (id) => ipcRenderer.invoke('commands:run', id),
  chatStatus: () => ipcRenderer.invoke('chat:status'),
  chatSend: (request) => ipcRenderer.invoke('chat:send', request),
  chatStop: (id) => ipcRenderer.send('chat:stop', id),
  onChatDelta: on('chat:delta'),
  openApps: () => ipcRenderer.invoke('apps:list'),
  findApp: (wanted) => ipcRenderer.invoke('apps:find', wanted),
  closeApp: (name, force) => ipcRenderer.invoke('apps:close', { name, force: Boolean(force) }),
  focusOverlay: (on) => ipcRenderer.send('overlay:focus', Boolean(on)),
});
