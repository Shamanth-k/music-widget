import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { isMusic, parseBridgeMessage, type Track } from './mediaModel.js'

type Action = 'play_pause' | 'next' | 'previous'
type Command = Action | 'get_current' | 'shutdown'
export function serializeBridgeCommand(command: Command) { return `${JSON.stringify({ command })}\n` }

type BridgeOptions = {
  resolveExecutable: () => string
  spawn: (executable: string) => ChildProcessWithoutNullStreams
  onMedia: (track: Track | null) => void
  log: (message: string, error?: unknown) => void
  maxRestarts?: number
  retryDelayMs?: number
  shutdownTimeoutMs?: number
  stablePeriodMs?: number
}

export function resolveBridgeExecutable(options: { packaged: boolean; resourcesPath: string; mainDirectory: string }) {
  if (options.packaged) return path.join(options.resourcesPath, 'media-bridge', 'MediaBridge.exe')
  return path.resolve(options.mainDirectory, '../electron/native/MediaBridge/bin/Release/net8.0-windows10.0.26100.0/win-x64/publish/MediaBridge.exe')
}

export function dispatchMediaAction(service: Pick<MediaBridgeService, 'sendAction'>, trusted: boolean, command: unknown) {
  if (!trusted || (command !== 'play_pause' && command !== 'next' && command !== 'previous')) return false
  return service.sendAction(command)
}

export class MediaBridgeService {
  private readonly options: BridgeOptions
  private child: ChildProcessWithoutNullStreams | null = null
  private activeTrack: Track | null = null
  private retryTimer: NodeJS.Timeout | undefined
  private stableTimer: NodeJS.Timeout | undefined
  private restarts = 0
  private stopped = false
  private shutdownPromise: Promise<void> | null = null

  constructor(options: BridgeOptions) { this.options = options }

  start() {
    if (this.stopped || this.child || this.retryTimer) return
    this.launch()
  }

  sendAction(command: Action) {
    if (!this.child || !this.child.stdin.writable || !isMusic(this.activeTrack)) return false
    this.writeCommand(command)
    return true
  }

  async shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearTimeout(this.stableTimer)
    this.retryTimer = undefined
    const child = this.child
    if (!child) return

    this.shutdownPromise = new Promise(resolve => {
      let complete = false
      const finish = () => {
        if (complete) return
        complete = true
        clearTimeout(killTimer)
        resolve()
      }
      const killTimer = setTimeout(() => {
        if (!child.killed) child.kill()
        setTimeout(finish, 1000)
      }, this.options.shutdownTimeoutMs ?? 1200)
      child.once('exit', finish)
      child.once('error', finish)
      try {
        if (child.stdin.writable) child.stdin.write(`${JSON.stringify({ command: 'shutdown' })}\n`, error => { if (error) child.kill() })
        else child.kill()
      } catch (error) {
        this.options.log('Failed to send MediaBridge shutdown command', error)
        child.kill()
      }
    })
    return this.shutdownPromise
  }

  private launch() {
    if (this.stopped || this.child) return
    let child: ChildProcessWithoutNullStreams
    try {
      child = this.options.spawn(this.options.resolveExecutable())
    } catch (error) {
      this.options.log('Unable to spawn MediaBridge', error)
      this.scheduleRestart()
      return
    }

    this.child = child
    let buffer = ''
    const decoder = new StringDecoder('utf8')
    let stdinWritable = child.stdin.writable
    let finalized = false
    const finish = (reason: string, error?: unknown) => {
      if (finalized) return
      finalized = true
      clearTimeout(this.stableTimer)
      this.stableTimer = undefined
      if (this.child === child) this.child = null
      if (error) this.options.log(reason, error)
      else if (!this.stopped) this.options.log(reason)
      if (!this.stopped) {
        this.updateMedia(null)
        this.scheduleRestart()
      }
    }

    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk)
      if (buffer.length > 12_000_000 && !buffer.includes('\n')) {
        buffer = ''
        this.options.log('Discarded oversized MediaBridge message')
        return
      }
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (!line.trim()) continue
        if (line.length > 12_000_000) {
          this.options.log('Discarded oversized MediaBridge message')
          continue
        }
        const message = parseBridgeMessage(line)
        if (!message) {
          this.options.log(`Ignored malformed or unsupported MediaBridge message: ${line.slice(0, 500)}`)
          continue
        }
        switch (message.type) {
          case 'media_update': this.updateMedia(message.data && isMusic(message.data) ? message.data : null); break
          case 'bridge_status': this.options.log(`[MediaBridge] ${message.stage}${message.sessionFound === undefined ? '' : `; sessionFound=${message.sessionFound}`}${message.sourceAppId ? `; source=${message.sourceAppId}` : ''}${message.playbackType ? `; playbackType=${message.playbackType}` : ''}${message.details ? `; ${message.details}` : ''}`); break
          case 'command_result':
            if (message.success) this.options.log(`[MediaBridge] command succeeded: ${message.command}`)
            else this.options.log(`[MediaBridge] command failed: ${message.command}; ${message.error?.code ?? 'unknown'}: ${message.error?.message ?? 'no native error detail'}`)
            break
          case 'bridge_error': this.options.log(`[MediaBridge] bridge error ${message.error.code}: ${message.error.message}${message.error.exceptionType ? ` (${message.error.exceptionType})` : ''}${message.error.hresult ? ` HRESULT=${message.error.hresult}` : ''}`); break
        }
      }
    })
    child.stderr.on('data', chunk => this.options.log(`[MediaBridge] ${chunk.toString().trimEnd()}`))
    child.stdin.on('error', error => { stdinWritable = false; this.options.log('MediaBridge stdin error', error) })
    child.stdin.on('close', () => { stdinWritable = false })
    child.once('error', error => finish('MediaBridge process error', error))
    child.once('exit', (code, signal) => finish(`MediaBridge exited (code=${code}, signal=${signal})`))
    this.stableTimer = setTimeout(() => { this.restarts = 0 }, this.options.stablePeriodMs ?? 60_000)
    this.writeCommand('get_current', stdinWritable)
  }

  private updateMedia(track: Track | null) {
    this.activeTrack = track
    this.options.onMedia(track)
  }

  private writeCommand(command: Command, writable = this.child?.stdin.writable ?? false) {
    if (!this.child || !writable) {
      this.options.log(`Cannot send MediaBridge command ${command}: stdin is not writable`)
      return false
    }
    try {
      this.child.stdin.write(serializeBridgeCommand(command), error => {
        if (error) this.options.log(`Failed to send MediaBridge command ${command}`, error)
      })
      return true
    } catch (error) {
      this.options.log(`Failed to send MediaBridge command: ${command}`, error)
      return false
    }
  }

  private scheduleRestart() {
    if (this.stopped || this.retryTimer || this.restarts >= (this.options.maxRestarts ?? 4)) return
    this.restarts += 1
    const delay = (this.options.retryDelayMs ?? 1000) * 2 ** (this.restarts - 1)
    this.options.log(`Restarting MediaBridge in ${delay}ms (attempt ${this.restarts})`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      this.launch()
    }, delay)
  }
}
