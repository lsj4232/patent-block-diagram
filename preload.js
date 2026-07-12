const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  saveJSON: data => ipcRenderer.invoke('save-json', data),
  loadJSON: () => ipcRenderer.invoke('load-json'),
  exportPNG: dataURL => ipcRenderer.invoke('export-png', dataURL)
})
