import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { dispatchMediaAction, MediaBridgeService, resolveBridgeExecutable, serializeBridgeCommand } from '../dist-electron/mediaBridge.js'
import { parseBridgeMessage } from '../electron/mediaModel.ts'

const music = { title:'Song', artist:'Artist', album:'Album', playbackType:'music', playbackStatus:'paused', position:20, duration:90, canPlayPause:true, canPrevious:true, canNext:true }

class FakeBridge extends EventEmitter {
  commands = []
  killed = false
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = Object.assign(new EventEmitter(), {
    writable: true,
    write: (data, callback) => {
      this.commands.push(data)
      callback?.()
      if (JSON.parse(data).command === 'shutdown') setImmediate(() => this.emit('exit',0,null))
      return true
    },
  })
  kill() { this.killed = true; setImmediate(() => this.emit('exit',null,'SIGTERM')); return true }
}

function serviceWith(spawn, overrides = {}) {
  const updates = [], logs = []
  const service = new MediaBridgeService({
    resolveExecutable:()=>'MediaBridge.exe', spawn,
    onMedia:track=>updates.push(track), log:(message,error)=>logs.push([message,error]),
    retryDelayMs:2, stablePeriodMs:100_000, shutdownTimeoutMs:30, ...overrides,
  })
  return { service, updates, logs }
}

test('resolves development and packaged bridge files from their runtime roots', () => {
  const dev = resolveBridgeExecutable({packaged:false,resourcesPath:'C:\\app\\resources',mainDirectory:'C:\\app\\dist-electron'})
  const packaged = resolveBridgeExecutable({packaged:true,resourcesPath:'C:\\app\\resources',mainDirectory:'C:\\ignored'})
  assert.equal(dev,path.resolve('C:\\app\\dist-electron','../electron/native/MediaBridge/bin/Release/net8.0-windows10.0.26100.0/win-x64/publish/MediaBridge.exe'))
  assert.equal(packaged,path.join('C:\\app\\resources','media-bridge','MediaBridge.exe'))
})

test('parses split UTF-8 JSON lines, filters video, and gates playback commands', async () => {
  const child = new FakeBridge()
  const { service, updates } = serviceWith(()=>child)
  service.start()
  service.start()
  assert.equal(child.commands.length,1)
  assert.equal(service.sendAction('next'),false)

  const received = new Promise(resolve => {
    const wait = setInterval(() => { if (updates.some(track=>track?.title==='夜の曲')) { clearInterval(wait);resolve() } },1)
  })
  const bytes = Buffer.from(`${JSON.stringify({type:'media_update',data:{...music,title:'夜の曲'}})}\n`)
  const split = bytes.indexOf(Buffer.from('夜')) + 1
  child.stdout.write(bytes.subarray(0,split))
  child.stdout.write(bytes.subarray(split))
  await received
  assert.equal(updates.at(-1).title,'夜の曲')
  assert.equal(service.sendAction('next'),true)
  assert.equal(JSON.parse(child.commands.at(-1)).command,'next')

  child.stdout.write(`${JSON.stringify({type:'media_update',data:{...music,playbackType:'video'}})}\n`)
  assert.equal(updates.at(-1),null)
  assert.equal(service.sendAction('previous'),false)
  await service.shutdown()
  assert.equal(JSON.parse(child.commands.at(-1)).command,'shutdown')
  assert.ok(child.commands.every(command=>command.endsWith('\n')))
  assert.equal(child.killed,false)
})

test('handles blank, malformed, multiple, and versioned diagnostic stdout lines', () => {
  const child = new FakeBridge()
  const { service, updates, logs } = serviceWith(()=>child)
  service.start()
  child.stdout.write(`\n{bad json}\n${JSON.stringify({protocolVersion:1,type:'bridge_status',stage:'session_selected',sessionFound:false})}\n${JSON.stringify({protocolVersion:1,type:'media_update',data:null})}\n${JSON.stringify({protocolVersion:1,type:'command_result',command:'next',success:false,error:{code:'native_exception',message:'HRESULT failure'}})}\n`)
  assert.deepEqual(updates,[null])
  assert.ok(logs.some(([message])=>message.includes('malformed or unsupported')))
  assert.ok(logs.some(([message])=>message.includes('session_selected; sessionFound=false')))
  assert.ok(logs.some(([message])=>message.includes('native_exception: HRESULT failure')))
  assert.equal(parseBridgeMessage('{"protocolVersion":99,"type":"bridge_status","stage":"started"}'),null)
  service.shutdown()
})

test('serializes each native command as one newline-terminated JSON object', () => {
  for (const command of ['get_current','play_pause','previous','next','shutdown']) {
    assert.equal(serializeBridgeCommand(command),`${JSON.stringify({command})}\n`)
  }
})

test('logs stdin errors and stops sending to a closed bridge', () => {
  const child = new FakeBridge()
  const { service, logs } = serviceWith(()=>child)
  service.start()
  child.stdout.write(`${JSON.stringify({protocolVersion:1,type:'media_update',data:music})}\n`)
  child.stdin.writable = false
  child.stdin.emit('error',new Error('pipe closed'))
  assert.equal(service.sendAction('next'),false)
  assert.ok(logs.some(([message,error])=>message==='MediaBridge stdin error'&&error.message==='pipe closed'))
  service.shutdown()
})

test('reports native no-session command errors in the versioned protocol', () => {
  const error = {protocolVersion:1,type:'command_result',command:'next',success:false,error:{code:'no_session',message:'No current GSMTC session is available.'}}
  assert.deepEqual(parseBridgeMessage(JSON.stringify(error)),error)
  assert.equal(parseBridgeMessage(JSON.stringify({protocolVersion:1,type:'media_update',data:{...music,duration:'90'}})),null)
})

test('media IPC rejects untrusted senders, invalid actions, and missing sessions', () => {
  const sent = []
  const service = { sendAction:command=>{sent.push(command);return true} }
  assert.equal(dispatchMediaAction(service,false,'next'),false)
  assert.equal(dispatchMediaAction(service,true,'stop'),false)
  assert.equal(dispatchMediaAction(service,true,'play_pause'),true)
  assert.deepEqual(sent,['play_pause'])
})

test('restarts a failed process only up to its configured limit and shuts down cleanly', async () => {
  const children = []
  const { service, logs } = serviceWith(()=>{
    const child=new FakeBridge();children.push(child)
    setImmediate(()=>child.emit('error',new Error('spawn failed')))
    return child
  },{maxRestarts:2})
  service.start()
  await new Promise(resolve=>setTimeout(resolve,35))
  assert.equal(children.length,3)
  assert.ok(logs.some(([message])=>message.includes('process error')))
  assert.ok(logs.some(([message])=>message.includes('Restarting MediaBridge')))
  await service.shutdown()
  assert.equal(children[2].killed,false)
})
