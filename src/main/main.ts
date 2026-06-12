import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
} from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import http from 'http'
import net from 'net'
import yaml from 'js-yaml'
import {
  AppConfig,
  Provider,
  ProxyStatus,
  TestConnectionResult,
  ApplyResult,
  IPC,
} from '../shared/types'

const CONFIG_DIR = path.join(os.homedir(), '.hermes-provider-switcher')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

const DEFAULT_CONFIG: AppConfig = {
  hermes_config_path: '',
  active_provider_id: null,
  providers: [],
}

let proxyServer: http.Server | null = null
let proxyStatus: ProxyStatus = { running: false, port: 0, provider_id: null }
let mainWindow: BrowserWindow | null = null

function maskKey(key: string): string {
  if (!key || key.length <= 8) return '***'
  return key.slice(0, 6) + '******' + key.slice(-4)
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function loadConfig(): AppConfig {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
    if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG }
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }
  } catch (e) {
    log(`loadConfig error: ${e}`)
    return { ...DEFAULT_CONFIG }
  }
}

function saveConfig(cfg: AppConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
  } catch (e) {
    log(`saveConfig error: ${e}`)
  }
}

function isPortBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port, '127.0.0.1')
  })
}

async function startProxy(provider: Provider): Promise<ProxyStatus> {
  if (proxyServer) await stopProxy()

  const port = provider.proxy_port || 15722
  if (await isPortBusy(port)) {
    return { running: false, port, provider_id: provider.id, error: `端口 ${port} 已被占用` }
  }

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

  proxyServer = http.createServer((req, res) => {
    const url = req.url || ''

    if (req.method === 'GET' && (url === '/v1/models' || url === '/v1/models/')) {
      const models = (provider.models || []).map((m) => ({
        id: m,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: provider.name,
      }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: models }))
      return
    }

    if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/v1/chat/completions/')) {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        try {
          const payload: Record<string, unknown> = JSON.parse(body)
          const origModel = payload.model as string
          payload.model = provider.model_mapping?.[origModel] ?? origModel

          if (provider.strip_tools) {
            delete payload.tools
            delete payload.tool_choice
            delete payload.parallel_tool_calls
            delete payload.reasoning_effort
          }

          const upstreamBase = provider.base_url.replace(/\/$/, '')
          const upstreamUrl = `${upstreamBase}/chat/completions`
          const upstreamUrlObj = new URL(upstreamUrl)
          const isHttps = upstreamUrlObj.protocol === 'https:'
          const httpModule = isHttps ? await import('https') : await import('http')

          const headers: Record<string, string> = {
            Authorization: `Bearer ${provider.api_key}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': userAgent,
          }
          for (const h of provider.custom_headers || []) {
            if (h.key) headers[h.key] = h.value
          }

          const bodyStr = JSON.stringify(payload)
          headers['Content-Length'] = String(Buffer.byteLength(bodyStr))
          log(`Proxy -> ${upstreamUrl} model=${payload.model as string} (was ${origModel}) apiKey=${maskKey(provider.api_key)}`)

          const upstreamReq = (httpModule as typeof import('https')).request(
            {
              hostname: upstreamUrlObj.hostname,
              port: upstreamUrlObj.port || (isHttps ? 443 : 80),
              path: upstreamUrlObj.pathname + upstreamUrlObj.search,
              method: 'POST',
              headers,
            },
            (upstreamRes) => {
              res.writeHead(upstreamRes.statusCode || 200, {
                'Content-Type': upstreamRes.headers['content-type'] || 'application/json',
              })
              upstreamRes.pipe(res)
            },
          )
          upstreamReq.on('error', (err) => {
            log(`Proxy upstream error: ${err.message}`)
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: { message: err.message, type: 'proxy_error' } }))
            }
          })
          upstreamReq.write(bodyStr)
          upstreamReq.end()
        } catch (e) {
          log(`Proxy parse error: ${e}`)
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: String(e), type: 'parse_error' } }))
        }
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  return new Promise((resolve) => {
    proxyServer!.listen(port, '127.0.0.1', () => {
      proxyStatus = { running: true, port, provider_id: provider.id }
      log(`Proxy started on 127.0.0.1:${port} for provider "${provider.name}"`)
      resolve(proxyStatus)
    })
    proxyServer!.on('error', (err) => {
      proxyStatus = { running: false, port, provider_id: provider.id, error: err.message }
      resolve(proxyStatus)
    })
  })
}

async function stopProxy(): Promise<void> {
  return new Promise((resolve) => {
    if (!proxyServer) {
      proxyStatus = { running: false, port: 0, provider_id: null }
      resolve()
      return
    }
    proxyServer.close(() => {
      proxyServer = null
      proxyStatus = { running: false, port: 0, provider_id: null }
      log('Proxy stopped')
      resolve()
    })
  })
}

function backupHermesConfig(configPath: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15)
  const backupPath = `${configPath}.backup-${ts}`
  fs.copyFileSync(configPath, backupPath)
  return backupPath
}

function applyProviderToHermes(configPath: string, provider: Provider): ApplyResult {
  try {
    if (!fs.existsSync(configPath)) {
      return { success: false, message: `找不到配置文件：${configPath}` }
    }

    const backupPath = backupHermesConfig(configPath)
    const raw = fs.readFileSync(configPath, 'utf8')
    let doc: Record<string, any>
    try {
      doc = (yaml.load(raw) as Record<string, unknown>) || {}
    } catch {
      doc = {}
    }

    const effectiveBaseUrl = provider.enable_local_proxy
      ? `http://127.0.0.1:${provider.proxy_port}/v1`
      : provider.base_url
    const effectiveModel = provider.default_model

    doc.model = {
      provider: provider.name,
      default: effectiveModel,
      base_url: effectiveBaseUrl,
      api_mode: provider.api_mode || 'chat_completions',
    }

    const modelsMap: Record<string, { name: string }> = {}
    for (const m of provider.models || []) modelsMap[m] = { name: m }
    if (effectiveModel && !modelsMap[effectiveModel]) modelsMap[effectiveModel] = { name: effectiveModel }

    let existingProviders: any[] = []
    if (Array.isArray(doc.custom_providers)) {
      existingProviders = doc.custom_providers.filter((p: any) => p?.name !== provider.name)
    }

    doc.custom_providers = [
      ...existingProviders,
      {
        name: provider.name,
        base_url: effectiveBaseUrl,
        api_key: provider.api_key,
        api_mode: provider.api_mode || 'chat_completions',
        model: effectiveModel,
        models: modelsMap,
      },
    ]

    fs.writeFileSync(configPath, yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8')
    log(`Applied provider "${provider.name}" to Hermes config. backup=${backupPath}`)

    return {
      success: true,
      message: `已成功写入 Hermes 配置，请重启 Hermes Agent 使其生效。备份：${path.basename(backupPath)}`,
      backup_path: backupPath,
    }
  } catch (e) {
    return { success: false, message: `写入失败：${e}` }
  }
}

async function testConnection(provider: Provider): Promise<TestConnectionResult> {
  const baseUrl = provider.base_url.replace(/\/$/, '')
  const t0 = Date.now()

  try {
    const resp = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${provider.api_key}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })
    const latency = Date.now() - t0

    if (!resp.ok) {
      return { success: false, message: `GET /models 返回 ${resp.status} ${resp.statusText}`, latency_ms: latency }
    }

    const data = await resp.json() as { data?: { id: string }[] }
    const models = (data.data || []).map((m) => m.id)
    return { success: true, message: `连接成功，延迟 ${latency}ms，共 ${models.length} 个模型`, models, latency_ms: latency }
  } catch (e) {
    return { success: false, message: `连接失败：${e}`, latency_ms: Date.now() - t0 }
  }
}

async function fetchModels(provider: Provider): Promise<TestConnectionResult> {
  const baseUrl = provider.base_url.replace(/\/$/, '')
  try {
    const resp = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${provider.api_key}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) return { success: false, message: `请求失败：${resp.status} ${resp.statusText}` }

    const data = await resp.json() as { data?: { id: string }[] }
    const models = (data.data || []).map((m) => m.id)
    return { success: true, message: `获取到 ${models.length} 个模型`, models }
  } catch (e) {
    return { success: false, message: `获取失败：${e}` }
  }
}

function createWindow() {
  const appPath = app.getAppPath()
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Hermes Provider Switcher',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(appPath, 'dist/renderer/index.html'))
  }
}

function registerIPC() {
  ipcMain.handle(IPC.GET_CONFIG, () => loadConfig())
  ipcMain.handle(IPC.SAVE_CONFIG, (_e, cfg: AppConfig) => {
    saveConfig(cfg)
    return true
  })
  ipcMain.handle(IPC.SELECT_HERMES_CONFIG, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择 Hermes config.yaml',
      filters: [{ name: 'YAML 配置', extensions: ['yaml', 'yml'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })
  ipcMain.handle(IPC.TEST_CONNECTION, async (_e, provider: Provider) => testConnection(provider))
  ipcMain.handle(IPC.FETCH_MODELS, async (_e, provider: Provider) => fetchModels(provider))
  ipcMain.handle(IPC.APPLY_PROVIDER, (_e, configPath: string, provider: Provider) => applyProviderToHermes(configPath, provider))
  ipcMain.handle(IPC.START_PROXY, async (_e, provider: Provider) => startProxy(provider))
  ipcMain.handle(IPC.STOP_PROXY, async () => {
    await stopProxy()
    return proxyStatus
  })
  ipcMain.handle(IPC.GET_PROXY_STATUS, () => proxyStatus)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerIPC()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await stopProxy()
  if (process.platform !== 'darwin') app.quit()
})
