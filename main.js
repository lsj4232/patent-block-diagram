const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: '특허 블록도 에디터',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  })
  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('save-json', async (e, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    filters: [{ name: '블록도 파일', extensions: ['json'] }],
    defaultPath: '도면.json'
  })
  if (canceled) return false
  fs.writeFileSync(filePath, data, 'utf-8')
  return true
})

ipcMain.handle('load-json', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [{ name: '블록도 파일', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (canceled) return null
  return fs.readFileSync(filePaths[0], 'utf-8')
})

ipcMain.handle('export-png', async (e, dataURL) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
    defaultPath: '도면.png'
  })
  if (canceled) return false
  fs.writeFileSync(filePath, Buffer.from(dataURL.split(',')[1], 'base64'))
  return true
})
