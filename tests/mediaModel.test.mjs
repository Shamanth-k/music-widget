import test from 'node:test'
import assert from 'node:assert/strict'
import { clampWindowPosition, defaultSettings, isMusic, normalizeSettings, parseBridgeLine, persistWindowPosition, progressPercent, updatePersistedSettings } from '../electron/mediaModel.ts'

const music = { title:'Song', artist:'Artist', album:'Album', playbackType:'music', playbackStatus:'playing', position:25, duration:100, canPlayPause:true, canPrevious:false, canNext:true }

test('accepts a well-formed media update and rejects malformed data', () => {
  assert.equal(parseBridgeLine(JSON.stringify({type:'media_update',data:music})).data.title,'Song')
  assert.equal(parseBridgeLine('{broken'),null)
  assert.equal(parseBridgeLine(JSON.stringify({type:'media_update',data:{...music,duration:'100'}})),null)
  assert.equal(parseBridgeLine(JSON.stringify({type:'other',data:music})),null)
})

test('filters video and unknown sessions', () => {
  assert.equal(isMusic(music),true)
  assert.equal(isMusic({...music,playbackType:'video'}),false)
  assert.equal(isMusic(null),false)
})

test('progress is bounded and handles a missing duration', () => {
  assert.equal(progressPercent(25,100),25)
  assert.equal(progressPercent(150,100),100)
  assert.equal(progressPercent(-1,100),0)
  assert.equal(progressPercent(5,0),0)
})

test('settings accept bounded values and reject invalid input', () => {
  assert.equal(defaultSettings.startWithWindows,false)
  assert.deepEqual(normalizeSettings({hideDelay:500,themeIntensity:75}),{hideDelay:500,themeIntensity:75})
  assert.equal(normalizeSettings({hideDelay:-1}),null)
  assert.equal(normalizeSettings({startWithWindows:'yes'}),null)
  assert.equal(normalizeSettings(null),null)
})

test('window positions clamp to the work area', () => {
  assert.deepEqual(clampWindowPosition(2000,-20,{x:0,y:0,width:1920,height:1080},500,255),{x:1420,y:0})
})

test('settings and the final window position persist through storage callbacks', () => {
  let storedSettings = { ...defaultSettings }
  let storedPosition = { x: 100, y: 200 }
  const updated = updatePersistedSettings(() => storedSettings, value => { storedSettings = value }, { startWithWindows: true })
  assert.equal(updated.startWithWindows,true)
  assert.equal(storedSettings.startWithWindows,true)
  persistWindowPosition((x,y) => { storedPosition = { x,y } },450,620)
  assert.deepEqual(storedPosition,{x:450,y:620})
})

test('null media updates and absent artwork remain valid', () => {
  assert.deepEqual(parseBridgeLine('{"type":"media_update","data":null}'),{type:'media_update',data:null})
  assert.equal(parseBridgeLine(JSON.stringify({type:'media_update',data:music})).data.artwork,undefined)
  assert.equal(parseBridgeLine(JSON.stringify({protocolVersion:1,type:'media_update',data:{...music,artwork:null}})).data.artwork,undefined)
  assert.equal(parseBridgeLine(JSON.stringify({protocolVersion:2,type:'media_update',data:music})),null)
})
