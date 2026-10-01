const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  media: {
    getCurrent: () => ipcRenderer.invoke('media:get'),
    onUpdate: (callback) => {
      const listener = (_event, value) => callback(value)
      ipcRenderer.on('media:update', listener)
      return () => ipcRenderer.removeListener('media:update', listener)
    },
    playPause: () => ipcRenderer.send('media:command', 'play_pause'),
    next: () => ipcRenderer.send('media:command', 'next'),
    previous: () => ipcRenderer.send('media:command', 'previous'),
  },
  window: {
    close: () => ipcRenderer.send('window:close'),
    hide: () => ipcRenderer.send('window:hide'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (value) => ipcRenderer.invoke('settings:set', value),
    onOpen: (callback) => {
      const listener = () => callback()
      ipcRenderer.on('settings:open', listener)
      return () => ipcRenderer.removeListener('settings:open', listener)
    },
  },
})
