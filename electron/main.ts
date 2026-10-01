/// <reference types="electron" />
import { app, BrowserWindow, ipcMain, Menu, screen, Tray } from 'electron/main'
import { nativeImage } from 'electron/common'
import type { BrowserWindow as BrowserWindowType, Tray as TrayType } from 'electron/main'
import Store from 'electron-store'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dispatchMediaAction, MediaBridgeService, resolveBridgeExecutable } from './mediaBridge.js'
import { clampWindowPosition, defaultSettings, persistWindowPosition, updatePersistedSettings, type Settings, type Track } from './mediaModel.js'
app.setName('Music Widget')
type Stored = { x?:number;y?:number;settings:Settings }
const store = new Store<Stored>({ name:'music-widget', defaults:{settings:defaultSettings} })
const here = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindowType | null = null
let tray: TrayType | null = null
let hideTimer: NodeJS.Timeout | undefined
let positionSaveTimer: NodeJS.Timeout | undefined
let quitting = false
let quitPrepared = false
let latest: Track | null = null
let manuallyHidden = false

function positionWindow() {
  const display = screen.getPrimaryDisplay(), area = display.workArea
  const width=420,height=220
  const x=store.get('settings').rememberPosition && store.get('x') !== undefined ? store.get('x')! : area.x+area.width-width-28
  const y=store.get('settings').rememberPosition && store.get('y') !== undefined ? store.get('y')! : area.y+area.height-height-32
  return clampWindowPosition(x,y,area,width,height)
}
function createWindow() {
  const p=positionWindow()
  mainWindow=new BrowserWindow({width:420,height:220,x:p.x,y:p.y,show:false,frame:false,transparent:true,resizable:false,alwaysOnTop:store.get('settings').alwaysOnTop,skipTaskbar:true,backgroundColor:'#00000000',webPreferences:{preload:app.isPackaged?path.join(app.getAppPath(),'electron','preload.cjs'):path.join(here,'../electron/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}})
  if (process.env.NODE_ENV === 'development') void mainWindow.loadURL('http://localhost:5173')
  else void mainWindow.loadFile(path.join(here,'../dist/index.html'))
  const rendererUrl=process.env.NODE_ENV==='development'?'http://localhost:5173':pathToFileURL(path.join(here,'../dist/index.html')).href
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(process.env.NODE_ENV==='development'? !url.startsWith(rendererUrl):url!==rendererUrl)event.preventDefault()})
  if (process.env.NODE_ENV === 'development') mainWindow.once('ready-to-show',showWidget)
  mainWindow.on('move',()=>{ if(!mainWindow || !store.get('settings').rememberPosition)return; const [x,y]=mainWindow.getPosition();clearTimeout(positionSaveTimer);positionSaveTimer=setTimeout(()=>persistWindowPosition((nextX,nextY)=>{store.set('x',nextX);store.set('y',nextY)},x,y),250) })
  mainWindow.on('close',event=>{ if(!quitting){event.preventDefault();mainWindow?.hide()} })
  mainWindow.on('closed',()=>{mainWindow=null})
  mainWindow.setAlwaysOnTop(store.get('settings').alwaysOnTop,'floating')
}
function showWidget(focus=true){ manuallyHidden=false;if(!mainWindow)createWindow(); if(mainWindow){if(focus)mainWindow.show();else mainWindow.showInactive();mainWindow.setAlwaysOnTop(store.get('settings').alwaysOnTop,'floating')} }
function hideWidget(manual=false){if(manual)manuallyHidden=true;mainWindow?.hide()}
function sendTrack(value:Track|null){const previous=latest;latest=value;mainWindow?.webContents.send('media:update',value);const activeMusic=value?.playbackType==='music'&&value.playbackStatus!=='stopped';if(activeMusic){clearTimeout(hideTimer);const trackChanged=!previous||previous.title!==value.title||previous.artist!==value.artist||previous.album!==value.album;const resumed=previous?.playbackStatus!=='playing'&&value.playbackStatus==='playing';if(store.get('settings').showWhenMusicStarts&&(!manuallyHidden||trackChanged||resumed))showWidget(false)}else if(store.get('settings').hideWhenMusicStops){clearTimeout(hideTimer);hideTimer=setTimeout(()=>hideWidget(),store.get('settings').hideDelay)}}
const mediaBridge = new MediaBridgeService({
  resolveExecutable:()=>resolveBridgeExecutable({packaged:app.isPackaged,resourcesPath:process.resourcesPath,mainDirectory:here}),
  spawn:executable=>spawn(executable,[],{stdio:['pipe','pipe','pipe'],windowsHide:true}),
  onMedia:sendTrack,
  log:(message,error)=>error?console.error(message,error):console.error(message),
})
function createTray(){const svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="7" fill="#192431"/><path d="M18 6v14a5 5 0 1 1-3-4.58V9l11-2v10a5 5 0 1 1-3-4.58V5z" fill="#9ce4d1"/></svg>';const icon=nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);tray=new Tray(icon);tray.setToolTip('Music Widget');tray.setContextMenu(Menu.buildFromTemplate([{label:'Music Widget',enabled:false},{type:'separator'},{label:'Show Widget',click:()=>showWidget()},{label:'Hide Widget',click:()=>hideWidget(true)},{label:'Settings',click:()=>{showWidget();mainWindow?.webContents.send('settings:open')}},{type:'separator'},{label:'Quit',click:()=>app.quit()}]))}
function trustedSender(event:Electron.IpcMainEvent|Electron.IpcMainInvokeEvent){const url=event.senderFrame?.url??'';return process.env.NODE_ENV==='development'?url.startsWith('http://localhost:5173/'):url.startsWith('file://')&&url.endsWith('/dist/index.html')}
function registerIpc(){
  ipcMain.handle('media:get',event=>trustedSender(event)?latest:null)
  ipcMain.on('media:command',(event,name)=>{if(!latest||latest.playbackType!=='music')return;dispatchMediaAction(mediaBridge,trustedSender(event),name)})
  ipcMain.on('window:hide',event=>{if(trustedSender(event))hideWidget(true)})
  ipcMain.on('window:close',event=>{if(trustedSender(event))hideWidget(true)})
  ipcMain.handle('settings:get',event=>trustedSender(event)?store.get('settings'):null)
  ipcMain.handle('settings:set',(event,value)=>{if(!trustedSender(event))throw new Error('Untrusted IPC sender');const settings=updatePersistedSettings(()=>store.get('settings'),next=>store.set('settings',next),value);if(!settings)throw new Error('Invalid settings');mainWindow?.setAlwaysOnTop(settings.alwaysOnTop,'floating');app.setLoginItemSettings({openAtLogin:settings.startWithWindows});return settings})
}
const hasInstanceLock=app.requestSingleInstanceLock()
if(!hasInstanceLock)app.quit()
else{
  app.on('second-instance',()=>showWidget())
  app.whenReady().then(()=>{createWindow();createTray();mediaBridge.start();registerIpc();app.setLoginItemSettings({openAtLogin:store.get('settings').startWithWindows});app.on('activate',()=>showWidget())})
}
app.on('before-quit',event=>{if(quitPrepared)return;event.preventDefault();if(quitting)return;quitting=true;clearTimeout(hideTimer);clearTimeout(positionSaveTimer);if(mainWindow&&store.get('settings').rememberPosition){const [x,y]=mainWindow.getPosition();persistWindowPosition((nextX,nextY)=>{store.set('x',nextX);store.set('y',nextY)},x,y)}void mediaBridge.shutdown().finally(()=>{quitPrepared=true;app.quit()})})
app.on('window-all-closed',()=>{})
