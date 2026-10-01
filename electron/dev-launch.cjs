const { spawn } = require('node:child_process')
const path = require('node:path')

const env = { ...process.env, NODE_ENV: 'development' }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(require('electron'), ['.'], {
  cwd: path.resolve(__dirname, '..'),
  env,
  stdio: 'inherit',
})

child.on('error', error => {
  console.error('Failed to launch Electron:', error)
  process.exitCode = 1
})
child.on('close', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
