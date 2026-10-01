import { useEffect, useState } from 'react'
import { progressPercent } from '../electron/mediaModel.js'
import './App.css'

type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'unknown'
type MediaTrack = {
  title: string; artist: string; album: string; artwork?: string
  playbackType: 'music' | 'video' | 'unknown'; playbackStatus: PlaybackStatus
  position: number; duration: number; canPlayPause: boolean; canPrevious: boolean; canNext: boolean
}
type Settings = { startWithWindows: boolean; alwaysOnTop: boolean; rememberPosition: boolean; showWhenMusicStarts: boolean; hideWhenMusicStops: boolean; hideDelay: number; playbackControls: boolean; themeIntensity: number }
const mock: MediaTrack = { title: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", artwork: '/mock-cover.svg', playbackType: 'music', playbackStatus: 'playing', position: 142, duration: 243, canPlayPause: true, canPrevious: true, canNext: true }
const defaults: Settings = { startWithWindows: false, alwaysOnTop: true, rememberPosition: true, showWhenMusicStarts: true, hideWhenMusicStops: true, hideDelay: 1800, playbackControls: true, themeIntensity: 60 }
declare global { interface Window { electronAPI?: { media: { getCurrent: () => Promise<MediaTrack | null>; onUpdate: (cb: (track: MediaTrack | null) => void) => () => void; playPause: () => void; next: () => void; previous: () => void }; window: { close: () => void; hide: () => void }; settings: { get: () => Promise<Settings>; set: (value: Partial<Settings>) => Promise<Settings>; onOpen: (callback: () => void) => () => void } } } }

function App() {
  const [session, setSession] = useState<{ track: MediaTrack; elapsed: number } | null>(import.meta.env.DEV ? { track: mock, elapsed: 0 } : null)
  const [settings, setSettings] = useState(defaults)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [colors, setColors] = useState(['#1c2939', '#272239'])
  const track = session?.track ?? null
  const isPlaying = track?.playbackStatus === 'playing'
  const position = track ? Math.min(track.duration || Infinity, track.position + (session?.elapsed ?? 0)) : 0
  useEffect(() => {
    let unsubscribe = () => {}
    const closeSettings = window.electronAPI?.settings.onOpen(() => setSettingsOpen(true))
    window.electronAPI?.settings.get().then(value => setSettings({ ...defaults, ...value })).catch(() => {})
    if (window.electronAPI) {
      window.electronAPI.media.getCurrent().then(value => { if (value) setSession({ track: value, elapsed: 0 }) }).catch(() => {})
      unsubscribe = window.electronAPI.media.onUpdate(value => setSession(value ? { track: value, elapsed: 0 } : null))
    }
    return () => { unsubscribe(); closeSettings?.() }
  }, [])
  useEffect(() => {
    if (!isPlaying) return
    const timer = window.setInterval(() => setSession(current => current ? { ...current, elapsed: current.elapsed + 0.12 } : null), 120)
    return () => window.clearInterval(timer)
  }, [isPlaying])
  const artwork = track?.artwork
  const themeIntensity = settings.themeIntensity
  useEffect(() => {
    if (!artwork) return
    const image = new Image(); image.src = artwork
    image.onload = () => { try { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.drawImage(image, 0, 0, 16, 16); const pixels = ctx.getImageData(0, 0, 16, 16).data; const buckets = new Map<number, { count:number; r:number; g:number; b:number }>(); for (let i=0; i<pixels.length; i+=4) { if (pixels[i+3] < 150) continue; const r=pixels[i],g=pixels[i+1],b=pixels[i+2],key=(r>>5)<<6|(g>>5)<<3|(b>>5); const bucket=buckets.get(key) ?? {count:0,r:0,g:0,b:0}; bucket.count++;bucket.r+=r;bucket.g+=g;bucket.b+=b;buckets.set(key,bucket) } const dominant=[...buckets.values()].sort((a,b)=>b.count-a.count).slice(0,2); if (!dominant.length) return; while (dominant.length<2) dominant.push(dominant[0]); const amount=themeIntensity/100*.34; setColors(dominant.map(color=>`rgb(${Math.round(color.r/color.count*amount)}, ${Math.round(color.g/color.count*amount)}, ${Math.round(color.b/color.count*amount)})`)) } catch { setColors(['#202838', '#28233a']) } }
  }, [artwork, themeIntensity])
  const progress = progressPercent(position, track?.duration ?? 0)
  const command = (action: 'playPause' | 'next' | 'previous') => { if (window.electronAPI) window.electronAPI.media[action](); else if (action === 'playPause' && session) setSession({ ...session, track: { ...session.track, playbackStatus: session.track.playbackStatus === 'playing' ? 'paused' : 'playing' } }) }
  const updateSetting = async (key: keyof Settings, value: boolean | number) => { const next = { ...settings, [key]: value }; setSettings(next); await window.electronAPI?.settings.set({ [key]: value }).catch(() => {}) }
  const backgroundColors = artwork ? colors : ['#202838', '#28233a']
  return <main className="widget" style={{ background: `linear-gradient(125deg, ${backgroundColors[0]}, ${backgroundColors[1]} 75%)` }}>
    <header className="topbar"><div className="live"><i /> {track ? 'NOW PLAYING' : 'WAITING FOR MUSIC'}</div><div className="window-actions"><button aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(!settingsOpen)} className="icon-button">⚙</button><button aria-label="Close widget" title="Hide widget" onClick={() => window.electronAPI?.window.close()} className="icon-button close">×</button></div></header>
    {settingsOpen ? <section className="settings"><div className="settings-title">Widget settings<button className="icon-button" onClick={() => setSettingsOpen(false)}>×</button></div>{([['startWithWindows','Start with Windows'],['alwaysOnTop','Always on top'],['rememberPosition','Remember position'],['showWhenMusicStarts','Show when music starts'],['hideWhenMusicStops','Hide when music stops'],['playbackControls','Playback controls']] as const).map(([key,label]) => <label className="setting-row" key={key}>{label}<input type="checkbox" checked={settings[key]} onChange={e => void updateSetting(key,e.target.checked)} /></label>)}<label className="setting-row range">Hide delay <span>{settings.hideDelay} ms</span><input type="range" min="0" max="10000" step="250" value={settings.hideDelay} onChange={e => void updateSetting('hideDelay',Number(e.target.value))}/></label><label className="setting-row range">Theme intensity <span>{settings.themeIntensity}%</span><input type="range" min="10" max="100" value={settings.themeIntensity} onChange={e => void updateSetting('themeIntensity',Number(e.target.value))}/></label></section> : <><section className="track-layout"><div className="art-frame">{track?.artwork ? <img className="art" src={track.artwork} alt={`${track.album} cover`} /> : <div className="art placeholder"><span>♫</span><small>NO ARTWORK</small></div>}<span className="art-corner" /></div><div className="details"><div className="eyebrow">{track?.album || 'MEDIA SESSION'}</div><h1 title={track?.title}>{track?.title || 'Waiting for music'}</h1><p>{track?.artist || 'Start playing a song'}</p><div className="controls"><button aria-label="Previous track" disabled={!track?.canPrevious || !settings.playbackControls} onClick={() => command('previous')}><svg viewBox="0 0 24 24"><path d="M6 5v14M19 6 8 12l11 6z"/></svg></button><button className="play" aria-label={track?.playbackStatus === 'playing' ? 'Pause' : 'Play'} disabled={!track?.canPlayPause || !settings.playbackControls} onClick={() => command('playPause')}>{track?.playbackStatus === 'playing' ? <svg viewBox="0 0 24 24"><path d="M8 5h3v14H8zM15 5h3v14h-3z"/></svg> : <svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>}</button><button aria-label="Next track" disabled={!track?.canNext || !settings.playbackControls} onClick={() => command('next')}><svg viewBox="0 0 24 24"><path d="M18 5v14M5 6l11 6-11 6z"/></svg></button></div></div></section><section className="timeline"><div className="bar"><span style={{ width: `${progress}%` }} /><i style={{ left: `${progress}%` }} /></div><div className="times"><span>{formatTime(position)}</span><span>{formatTime(track?.duration ?? 0)}</span></div></section></>}
    <footer><span className="equalizer"><i/><i/><i/><i/></span><span>LOCAL MEDIA SESSION</span><span className="pixel-mark">MW&nbsp; / &nbsp;01</span></footer>
  </main>
}
function formatTime(seconds: number) { const n = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` }
export default App
