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
const ROUTER_PROVIDER_NAME = 'hermes-switcher'

const DEFAULT_CONFIG: AppConfig = {
  hermes_config_path: '',
  active_provider_id: null,
  router_port: 15722,
  auto_start_proxy: true,
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

function normalizeConfig(raw: Partial<AppConfig>): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    router_port: raw.router_port || raw.providers?.[0]?.proxy_port || DEFAULT_CONFIG.router_port,
    auto_start_proxy: raw.auto_start_proxy ?? DEFAULT_CONFIG.auto_start_proxy,
    providers: raw.providers || [],
  }
}

function loadConfig(): AppConfig {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
    if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG }
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')))
  } catch (e) {
    log(`loadConfig error: ${e}`)
    return { ...DEFAULT_CONFIG }
  }
}

function saveConfig(cfg: AppConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalizeConfig(cfg), null, 2), 'utf8')
  } catch (e) {
    log(`saveConfig error: ${e}`)
  }
}

function getActiveProvider(): Provider | null {
  const cfg = loadConfig()
  return cfg.providers.find((p) => p.id === cfg.active_provider_id) || cfg.providers[0] || null
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

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function stripIncompatibleFields(payload: Record<string, unknown>) {
  delete payload.tools
  delete payload.tool_choice
  delete payload.parallel_tool_calls
  delete payload.reasoning_effort
}

async function forwardChatCompletion(provider: Provider, payload: Record<string, unknown>, res: http.ServerResponse) {
  const origModel = payload.model as string
  payload.model = provider.model_mapping?.[origModel] ?? origModel
  if (provider.strip_tools) stripIncompatibleFields(payload)

  const upstreamBase = provider.base_url.replace(/\/$/, '')
  const upstreamUrl = `${upstreamBase}/chat/completions`
  const upstreamUrlObj = new URL(upstreamUrl)
  const isHttps = upstreamUrlObj.protocol === 'https:'
  const httpModule = isHttps ? await import('https') : await import('http')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${provider.api_key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  }
  for (const h of provider.custom_headers || []) {
    if (h.key) headers[h.key] = h.value
  }

  const bodyStr = JSON.stringify(payload)
  headers['Content-Length'] = String(Buffer.byteLength(bodyStr))
  log(`Router -> ${upstreamUrl} provider=${provider.name} model=${payload.model as string} (was ${origModel}) apiKey=${maskKey(provider.api_key)}`)

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
    log(`Router upstream error: ${err.message}`)
    if (!res.headersSent) {
      sendJson(res, 502, { error: { message: err.message, type: 'proxy_error' } })
    }
  })
  upstreamReq.write(bodyStr)
  upstreamReq.end()
}

async function startProxy(port?: number): Promise<ProxyStatus> {
  const cfg = loadConfig()
  const routerPort = port || cfg.router_port || DEFAULT_CONFIG.router_port
  const active = getActiveProvider()

  if (proxyServer && proxyStatus.port === routerPort) {
    proxyStatus = {
      running: true,
      port: routerPort,
      provider_id: active?.id || null,
      provider_name: active?.name,
    }
    return proxyStatus
  }
  if (proxyServer) await stopProxy()

  if (await isPortBusy(routerPort)) {
    proxyStatus = { running: false, port: routerPort, provider_id: active?.id || null, provider_name: active?.name, error: `端口 ${routerPort} 已被占用` }
    return proxyStatus
  }

  proxyServer = http.createServer((req, res) => {
    const url = req.url || ''
    const provider = getActiveProvider()

    if (!provider) {
      sendJson(res, 503, { error: { message: '尚未选择可用供应商', type: 'no_active_provider' } })
      return
    }

    if (req.method === 'GET' && (url === '/v1/models' || url === '/v1/models/')) {
      const models = (provider.models.length ? provider.models : [provider.default_model]).filter(Boolean).map((m) => ({
        id: m,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: provider.name,
      }))
      sendJson(res, 200, { object: 'list', data: models })
      return
    }

    if (req.method === 'GET' && (url === '/health' || url === '/v1/health')) {
      sendJson(res, 200, {
        ok: true,
        provider: provider.name,
        model: provider.default_model,
        port: routerPort,
      })
      return
    }

    if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/v1/chat/completions/')) {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        try {
          await forwardChatCompletion(provider, JSON.parse(body), res)
        } catch (e) {
          log(`Router parse error: ${e}`)
          sendJson(res, 400, { error: { message: String(e), type: 'parse_error' } })
        }
      })
      return
    }

    sendJson(res, 404, { error: 'Not found' })
  })

  return new Promise((resolve) => {
    proxyServer!.listen(routerPort, '127.0.0.1', () => {
      proxyStatus = {
        running: true,
        port: routerPort,
        provider_id: active?.id || null,
        provider_name: active?.name,
      }
      log(`Router started on 127.0.0.1:${routerPort}`)
      resolve(proxyStatus)
    })
    proxyServer!.on('error', (err) => {
      proxyStatus = { running: false, port: routerPort, provider_id: active?.id || null, provider_name: active?.name, error: err.message }
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
      log('Router stopped')
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

    const cfg = loadConfig()
    const routerPort = cfg.router_port || provider.proxy_port || DEFAULT_CONFIG.router_port
    const backupPath = backupHermesConfig(configPath)
    const raw = fs.readFileSync(configPath, 'utf8')
    let doc: Record<string, any>
    try {
      doc = (yaml.load(raw) as Record<string, unknown>) || {}
    } catch {
      doc = {}
    }

    const baseUrl = `http://127.0.0.1:${routerPort}/v1`
    const model = provider.default_model || provider.models[0] || 'gpt-4o'

    doc.model = {
      provider: ROUTER_PROVIDER_NAME,
      default: model,
      base_url: baseUrl,
      api_mode: provider.api_mode || 'chat_completions',
    }

    const modelsMap: Record<string, { name: string }> = {}
    const hermesModels = Array.from(new Set([model, ...(provider.models || [])])).filter(Boolean)
    for (const m of hermesModels) modelsMap[m] = { name: m }

    let existingProviders: any[] = []
    if (Array.isArray(doc.custom_providers)) {
      existingProviders = doc.custom_providers.filter((p: any) => p?.name !== ROUTER_PROVIDER_NAME)
    }

    doc.custom_providers = [
      ...existingProviders,
      {
        name: ROUTER_PROVIDER_NAME,
        base_url: baseUrl,
        api_key: 'local-router',
        api_mode: provider.api_mode || 'chat_completions',
        model,
        models: modelsMap,
      },
    ]

    fs.writeFileSync(configPath, yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8')
    log(`Applied router config to Hermes. backup=${backupPath}`)

    return {
      success: true,
      message: `已把 Hermes 固定指向本地路由器 ${baseUrl}。以后切换供应商只需要在本软件里选择并启动路由器。备份：${path.basename(backupPath)}`,
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
    width: 1220,
    height: 820,
    minWidth: 940,
    minHeight: 620,
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
    const next = normalizeConfig(cfg)
    saveConfig(next)
    const active = next.providers.find((p) => p.id === next.active_provider_id) || null
    if (proxyStatus.running) {
      proxyStatus = { ...proxyStatus, provider_id: active?.id || null, provider_name: active?.name }
    }
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
  ipcMain.handle(IPC.START_PROXY, async (_e, providerOrPort?: Provider | number) => {
    const port = typeof providerOrPort === 'number' ? providerOrPort : undefined
    return startProxy(port)
  })
  ipcMain.handle(IPC.STOP_PROXY, async () => {
    await stopProxy()
    return proxyStatus
  })
  ipcMain.handle(IPC.GET_PROXY_STATUS, () => {
    const active = getActiveProvider()
    if (proxyStatus.running) {
      proxyStatus = { ...proxyStatus, provider_id: active?.id || null, provider_name: active?.name }
    }
    return proxyStatus
  })
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  registerIPC()
  createWindow()
  const cfg = loadConfig()
  if (cfg.auto_start_proxy && cfg.providers.length) {
    setTimeout(() => {
      startProxy(cfg.router_port).catch((err) => log(`Auto start router failed: ${err}`))
    }, 800)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await stopProxy()
  if (process.platform !== 'darwin') app.quit()
})
