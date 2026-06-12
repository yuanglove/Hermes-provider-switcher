#!/usr/bin/env node
/**
 * dev.js - 开发模式启动脚本
 */
const { spawn } = require('child_process')
const http = require('http')

const root = __dirname
let electronProc = null

const vite = spawn('npx', ['vite', '--host', '127.0.0.1'], {
  cwd: root, stdio: 'inherit', shell: true,
})

function waitForVite(retries) {
  const req = http.get('http://localhost:5173', () => {
    console.log('[dev] Vite ready, compiling main...')
    const tsc = spawn('npx', ['tsc', '-p', 'tsconfig.main.json'], {
      cwd: root, stdio: 'inherit', shell: true,
    })
    tsc.on('close', (code) => {
      if (code !== 0) { console.error('[dev] tsc failed'); return }
      electronProc = spawn('npx', ['electron', '.'], {
        cwd: root, stdio: 'inherit', shell: true,
        env: { ...process.env, NODE_ENV: 'development' },
      })
      electronProc.on('close', () => { vite.kill(); process.exit(0) })
    })
  })
  req.on('error', () => {
    if (retries > 0) setTimeout(() => waitForVite(retries - 1), 1000)
    else { console.error('[dev] Vite timeout'); process.exit(1) }
  })
  req.end()
}

process.on('SIGINT', () => {
  if (electronProc) electronProc.kill()
  vite.kill()
  process.exit(0)
})

setTimeout(() => waitForVite(30), 2000)
