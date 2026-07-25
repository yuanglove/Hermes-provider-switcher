import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
} from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import http from 'http'
import net from 'net'
import yaml from 'js-yaml'
import * as toml from '@iarna/toml'
import JSON5 from 'json5'
import { appendUsageRecord, atomicWrite, backupFile, loadManagedState, saveManagedState } from './managed-store'
import {
  AppConfig,
  Provider,
  ProxyStatus,
  TestConnectionResult,
  ApplyResult,
  ManagedState,
  PlatformStatus,
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
  launch_at_login: false,
  workspace_root: '',
  fallback_provider_ids: [],
  routing_mode: 'proxy',
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
    launch_at_login: raw.launch_at_login ?? DEFAULT_CONFIG.launch_at_login,
    workspace_root: typeof raw.workspace_root === 'string' ? raw.workspace_root : '',
    fallback_provider_ids: Array.isArray(raw.fallback_provider_ids) ? raw.fallback_provider_ids : [],
    routing_mode: raw.routing_mode === 'native' ? 'native' : 'proxy',
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

async function forwardChatCompletion(provider: Provider, payload: Record<string, unknown>, res: http.ServerResponse, attemptedProviderIds: string[] = []) {
  const startedAt = Date.now()
  const origModel = payload.model as string
  const sourcePayload = { ...payload, model: origModel }
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

  const record = (status: number, usage?: Record<string, unknown>) => {
    appendUsageRecord({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      providerId: provider.id,
      providerName: provider.name,
      model: String(payload.model || origModel || provider.default_model),
      status,
      latencyMs: Date.now() - startedAt,
      promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
      completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : undefined,
      totalTokens: typeof usage?.total_tokens === 'number' ? usage.total_tokens : undefined,
    })
  }

  const upstreamReq = (httpModule as typeof import('https')).request(
    {
      hostname: upstreamUrlObj.hostname,
      port: upstreamUrlObj.port || (isHttps ? 443 : 80),
      path: upstreamUrlObj.pathname + upstreamUrlObj.search,
      method: 'POST',
      headers,
    },
    (upstreamRes) => {
      const chunks: Buffer[] = []
      let responseSize = 0
      upstreamRes.on('data', (chunk: Buffer) => {
        responseSize += chunk.length
        if (responseSize <= 1024 * 1024) chunks.push(chunk)
      })
      upstreamRes.on('end', () => {
        let usage: Record<string, unknown> | undefined
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { usage?: Record<string, unknown> }
          usage = parsed.usage
        } catch { /* Streaming and non-JSON responses have no usage payload to record. */ }
        record(upstreamRes.statusCode || 200, usage)
      })
      res.writeHead(upstreamRes.statusCode || 200, {
        'Content-Type': upstreamRes.headers['content-type'] || 'application/json',
      })
      upstreamRes.pipe(res)
    },
  )
  upstreamReq.on('error', (err) => {
    const attempted = [...attemptedProviderIds, provider.id]
    const cfg = loadConfig()
    const fallback = cfg.providers.find((candidate) => cfg.fallback_provider_ids.includes(candidate.id) && !attempted.includes(candidate.id))
    if (fallback && !res.headersSent) {
      log(`Router upstream error for ${provider.name}; retrying with fallback ${fallback.name}: ${err.message}`)
      void forwardChatCompletion(fallback, sourcePayload, res, attempted)
      return
    }
    log(`Router upstream error: ${err.message}`)
    record(502)
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
    if (!fs.existsSync(configPath)) return { success: false, message: `找不到配置文件：${configPath}` }

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

    const model = provider.default_model || provider.models[0] || 'gpt-4o'
    const modelsMap: Record<string, { name: string }> = {}
    for (const item of Array.from(new Set([model, ...(provider.models || [])])).filter(Boolean)) modelsMap[item] = { name: item }

    const isNative = cfg.routing_mode === 'native'
    const providerName = isNative ? (provider.name.trim() || 'hermes-provider') : ROUTER_PROVIDER_NAME
    const baseUrl = isNative ? provider.base_url.replace(/\/+$/, '') : `http://127.0.0.1:${routerPort}/v1`
    const apiKey = isNative ? provider.api_key : 'local-router'

    doc.model = {
      provider: providerName,
      default: model,
      base_url: baseUrl,
      api_mode: provider.api_mode || 'chat_completions',
    }

    const existingProviders = Array.isArray(doc.custom_providers)
      ? doc.custom_providers.filter((item: any) => item?.name !== providerName)
      : []

    doc.custom_providers = [
      ...existingProviders,
      {
        name: providerName,
        base_url: baseUrl,
        api_key: apiKey,
        api_mode: provider.api_mode || 'chat_completions',
        model,
        models: modelsMap,
      },
    ]

    fs.writeFileSync(configPath, yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8')
    const message = isNative
      ? `已将 ${providerName} 写入 Hermes 原生供应商列表并设为当前模型。备份：${path.basename(backupPath)}`
      : `已把 Hermes 固定指向本地路由器 ${baseUrl}。以后切换供应商只需要在本软件里选择并启动路由器。备份：${path.basename(backupPath)}`
    log(`Applied ${isNative ? 'native' : 'router'} Hermes config. backup=${backupPath}`)

    return { success: true, message, backup_path: backupPath }
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

function syncMcpServers(state: ManagedState, hermesConfigPath: string): ApplyResult {
  try {
    const serversFor = (platform: string) => Object.fromEntries(
      state.mcpServers
        .filter((server) => server.enabledPlatforms.includes(platform as any))
        .map((server) => [server.name, { command: server.command, args: server.args, env: server.env }]),
    )

    const syncJson = (filePath: string, platform: string, key = 'mcpServers', transform?: (servers: Record<string, unknown>) => Record<string, unknown>) => {
      let document: Record<string, unknown> = {}
      if (fs.existsSync(filePath)) {
        try { document = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown> } catch { throw new Error(`无法解析配置：${filePath}`) }
      }
      backupFile(filePath)
      document[key] = transform ? transform(serversFor(platform)) : serversFor(platform)
      atomicWrite(filePath, JSON.stringify(document, null, 2))
    }

    const syncToml = (filePath: string, platform: string) => {
      let document: Record<string, any> = {}
      if (fs.existsSync(filePath)) {
        try { document = toml.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, any> } catch { throw new Error(`无法解析 TOML：${filePath}`) }
      }
      backupFile(filePath)
      document.mcp_servers = Object.fromEntries(Object.entries(serversFor(platform)).map(([name, spec]: [string, any]) => [name, { type: 'stdio', ...spec }]))
      atomicWrite(filePath, toml.stringify(document))
    }

    const home = os.homedir()
    syncJson(path.join(home, '.claude.json'), 'claude-code')
    syncJson(path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json'), 'claude-desktop')
    syncJson(path.join(home, '.gemini', 'settings.json'), 'gemini-cli')
    syncToml(path.join(home, '.codex', 'config.toml'), 'codex')
    syncToml(path.join(home, '.grok', 'config.toml'), 'grok-build')
    syncJson(path.join(home, '.config', 'opencode', 'opencode.json'), 'opencode', 'mcp', (servers) => Object.fromEntries(Object.entries(servers).map(([name, spec]: [string, any]) => [name, { type: 'local', command: [spec.command, ...(spec.args || [])], environment: spec.env, enabled: true }])))

    if (hermesConfigPath) {
      let document: Record<string, unknown> = {}
      if (fs.existsSync(hermesConfigPath)) {
        try { document = (yaml.load(fs.readFileSync(hermesConfigPath, 'utf8')) as Record<string, unknown>) || {} } catch { throw new Error(`无法解析 Hermes 配置：${hermesConfigPath}`) }
      }
      backupFile(hermesConfigPath)
      document.mcp_servers = serversFor('hermes')
      atomicWrite(hermesConfigPath, yaml.dump(document, { indent: 2, lineWidth: -1, noRefs: true }))
    }

    return { success: true, message: 'MCP 已同步到 Claude、Codex、Gemini、Grok Build、OpenCode 和 Hermes；OpenClaw 当前版本不支持 MCP。' }
  } catch (error) {
    return { success: false, message: `MCP 同步失败：${error}` }
  }
}

function syncPrompts(state: ManagedState): ApplyResult {
  try {
    const home = os.homedir()
    const targets: Array<[string, string, string]> = [
      ['claude-code', path.join(home, '.claude', 'CLAUDE.md'), 'Claude Code'],
      ['codex', path.join(home, '.codex', 'AGENTS.md'), 'Codex'],
      ['gemini-cli', path.join(home, '.gemini', 'GEMINI.md'), 'Gemini CLI'],
      ['grok-build', path.join(home, '.grok', 'GROK.md'), 'Grok Build'],
      ['opencode', path.join(home, '.config', 'opencode', 'AGENTS.md'), 'OpenCode'],
      ['hermes', path.join(home, '.hermes', 'memories', 'USER.md'), 'Hermes'],
    ]

    for (const [platform, filePath] of targets) {
      const content = state.prompts
        .filter((prompt) => prompt.enabledPlatforms.includes(platform as any))
        .map((prompt) => `## ${prompt.name}\n\n${prompt.content.trim()}`)
        .join('\n\n')
      if (!content) continue
      backupFile(filePath)
      const markerStart = '<!-- Hermes Provider Switcher: prompts start -->'
      const markerEnd = '<!-- Hermes Provider Switcher: prompts end -->'
      const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
      const withoutManaged = previous.replace(new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}\\s*`, 'g'), '').trimEnd()
      atomicWrite(filePath, `${withoutManaged}${withoutManaged ? '\n\n' : ''}${markerStart}\n${content}\n${markerEnd}\n`)
    }
    return { success: true, message: '提示词已同步到启用的平台 Markdown 文件，原文件已备份。' }
  } catch (error) {
    return { success: false, message: `提示词同步失败：${error}` }
  }
}

function syncSkills(state: ManagedState): ApplyResult {
  try {
    const home = os.homedir()
    const targets: Array<[string, string]> = [
      ['claude-code', path.join(home, '.claude', 'skills')],
      ['claude-desktop', path.join(home, '.claude-desktop', 'skills')],
      ['codex', path.join(home, '.codex', 'skills')],
      ['gemini-cli', path.join(home, '.gemini', 'skills')],
      ['grok-build', path.join(home, '.grok', 'skills')],
      ['opencode', path.join(home, '.config', 'opencode', 'skills')],
      ['openclaw', path.join(home, '.openclaw', 'skills')],
      ['hermes', path.join(home, '.hermes', 'skills')],
    ]

    for (const skill of state.skills) {
      if (!fs.existsSync(skill.sourcePath) || !fs.statSync(skill.sourcePath).isDirectory()) {
        return { success: false, message: `找不到 Skills 源目录：${skill.sourcePath}` }
      }
      for (const [platform, baseDir] of targets) {
        if (!skill.enabledPlatforms.includes(platform as any)) continue
        const destination = path.join(baseDir, skill.name)
        if (fs.existsSync(destination)) {
          backupFile(destination)
          fs.rmSync(destination, { recursive: true, force: true })
        }
        fs.mkdirSync(baseDir, { recursive: true })
        try {
          fs.symlinkSync(skill.sourcePath, destination, 'junction')
        } catch {
          fs.cpSync(skill.sourcePath, destination, { recursive: true })
        }
      }
    }
    return { success: true, message: 'Skills 已同步到启用的平台；已有目标目录已备份。' }
  } catch (error) {
    return { success: false, message: `Skills 同步失败：${error}` }
  }
}

function applyProviderToCliPlatform(platformId: 'claude-code' | 'gemini-cli', provider: Provider): ApplyResult {
  try {
    const home = os.homedir()
    const filePath = platformId === 'claude-code'
      ? path.join(home, '.claude', 'settings.json')
      : path.join(home, '.gemini', 'settings.json')
    let document: Record<string, any> = {}
    if (fs.existsSync(filePath)) {
      try { document = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return { success: false, message: `无法解析配置文件：${filePath}` } }
      backupFile(filePath)
    }
    const env = { ...(document.env || {}) }
    if (platformId === 'claude-code') {
      env.ANTHROPIC_BASE_URL = provider.base_url.replace(/\/+$/, '')
      env.ANTHROPIC_AUTH_TOKEN = provider.api_key
      env.ANTHROPIC_MODEL = provider.default_model
      document.env = env
    } else {
      env.GEMINI_API_KEY = provider.api_key
      env.GOOGLE_GEMINI_BASE_URL = provider.base_url.replace(/\/+$/, '')
      document.env = env
      if (provider.default_model) document.model = provider.default_model
    }
    atomicWrite(filePath, JSON.stringify(document, null, 2))
    return { success: true, message: `已写入 ${platformId === 'claude-code' ? 'Claude Code' : 'Gemini CLI'} 配置：${filePath}` }
  } catch (error) {
    return { success: false, message: `配置写入失败：${error}` }
  }
}

function applyProviderToOpenCode(provider: Provider): ApplyResult {
  try {
    const filePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json')
    let document: Record<string, any> = { $schema: 'https://opencode.ai/config.json' }
    if (fs.existsSync(filePath)) {
      try { document = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return { success: false, message: `无法解析 OpenCode 配置：${filePath}` } }
      backupFile(filePath)
    }
    const providers = { ...(document.provider || {}) }
    providers[provider.name || 'hermes-provider'] = {
      npm: '@ai-sdk/openai-compatible',
      name: provider.name || 'Hermes Provider',
      options: { baseURL: provider.base_url.replace(/\/+$/, ''), apiKey: provider.api_key },
      models: Object.fromEntries((provider.models.length ? provider.models : [provider.default_model]).filter(Boolean).map((model) => [model, { name: model }])),
    }
    document.provider = providers
    atomicWrite(filePath, JSON.stringify(document, null, 2))
    return { success: true, message: `已写入 OpenCode 配置：${filePath}` }
  } catch (error) { return { success: false, message: `OpenCode 配置写入失败：${error}` } }
}

function applyProviderToCodex(provider: Provider): ApplyResult {
  try {
    const filePath = path.join(os.homedir(), '.codex', 'config.toml')
    let document: Record<string, any> = {}
    if (fs.existsSync(filePath)) {
      try { document = toml.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, any> } catch { return { success: false, message: `无法解析 Codex TOML：${filePath}` } }
      backupFile(filePath)
    }
    const providerId = 'hermes_provider_switcher'
    document.model_provider = providerId
    document.model = provider.default_model
    document.model_providers = { ...(document.model_providers || {}), [providerId]: {
      name: provider.name || 'Hermes Provider Switcher',
      base_url: provider.base_url.replace(/\/+$/, ''),
      wire_api: provider.api_mode === 'responses' ? 'responses' : 'chat',
      requires_openai_auth: false,
      experimental_bearer_token: provider.api_key,
    } }
    atomicWrite(filePath, toml.stringify(document as any))
    return { success: true, message: `已写入 Codex 配置：${filePath}` }
  } catch (error) { return { success: false, message: `Codex 配置写入失败：${error}` } }
}

function applyProviderToClaudeDesktop(provider: Provider): ApplyResult {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const normalConfig = path.join(localAppData, 'Claude', 'claude_desktop_config.json')
    const threepDir = path.join(localAppData, 'Claude-3p')
    const threepConfig = path.join(threepDir, 'claude_desktop_config.json')
    const libraryDir = path.join(threepDir, 'configLibrary')
    const profileId = '00000000-0000-4000-8000-000000157210'
    const profilePath = path.join(libraryDir, `${profileId}.json`)
    const metaPath = path.join(libraryDir, '_meta.json')
    const readJson = (filePath: string): Record<string, any> => {
      if (!fs.existsSync(filePath)) return {}
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, any>
    }
    for (const candidate of [normalConfig, threepConfig, profilePath, metaPath]) backupFile(candidate)
    const setDeployment = (filePath: string) => {
      const value = readJson(filePath)
      value.deploymentMode = '3p'
      atomicWrite(filePath, JSON.stringify(value, null, 2))
    }
    setDeployment(normalConfig)
    setDeployment(threepConfig)
    const models = (provider.models.length ? provider.models : [provider.default_model]).filter(Boolean).map((name) => ({ name, label: name }))
    atomicWrite(profilePath, JSON.stringify({
      coworkEgressAllowedHosts: ['*'],
      disableDeploymentModeChooser: true,
      inferenceGatewayApiKey: provider.api_key,
      inferenceGatewayAuthScheme: 'bearer',
      inferenceGatewayBaseUrl: provider.base_url.replace(/\/+$/, ''),
      inferenceProvider: 'gateway',
      inferenceModels: models,
    }, null, 2))
    const meta = readJson(metaPath)
    const entries = Array.isArray(meta.entries) ? meta.entries.filter((entry: any) => entry?.id !== profileId) : []
    entries.push({ id: profileId, name: 'Hermes Provider Switcher' })
    meta.entries = entries
    meta.appliedId = profileId
    atomicWrite(metaPath, JSON.stringify(meta, null, 2))
    return { success: true, message: `已写入 Claude Desktop 3P Profile：${profilePath}` }
  } catch (error) { return { success: false, message: `Claude Desktop 配置写入失败：${error}` } }
}

function applyProviderToGrokBuild(provider: Provider): ApplyResult {
  try {
    const filePath = path.join(os.homedir(), '.grok', 'config.toml')
    let document: Record<string, any> = {}
    if (fs.existsSync(filePath)) { try { document = toml.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, any> } catch { return { success: false, message: `无法解析 Grok Build TOML：${filePath}` } }; backupFile(filePath) }
    const model = provider.default_model || provider.models[0] || 'grok-4.5'
    document.models = { ...(document.models || {}), default: model }
    document.model = { ...(document.model || {}), [model]: { model, base_url: provider.base_url.replace(/\/+$/, ''), name: provider.name, api_key: provider.api_key, api_backend: provider.api_mode === 'responses' ? 'responses' : 'chat_completions' } }
    atomicWrite(filePath, toml.stringify(document as any))
    return { success: true, message: `已写入 Grok Build 配置：${filePath}` }
  } catch (error) { return { success: false, message: `Grok Build 配置写入失败：${error}` } }
}

function applyProviderToOpenClaw(provider: Provider): ApplyResult {
  try {
    const filePath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    let document: Record<string, any> = { models: { mode: 'merge', providers: {} } }
    if (fs.existsSync(filePath)) {
      try { document = JSON5.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, any> } catch { return { success: false, message: `无法解析 OpenClaw JSON5：${filePath}` } }
      backupFile(filePath)
    }
    document.models = { ...(document.models || {}), mode: document.models?.mode || 'merge', providers: { ...(document.models?.providers || {}) } }
    const modelIds = (provider.models.length ? provider.models : [provider.default_model]).filter(Boolean)
    document.models.providers[provider.name || 'hermes-provider'] = {
      baseUrl: provider.base_url.replace(/\/+$/, ''),
      apiKey: provider.api_key,
      api: provider.api_mode === 'responses' ? 'openai-responses' : 'openai-completions',
      headers: Object.fromEntries(provider.custom_headers.map((header) => [header.key, header.value])),
      models: modelIds.map((id) => ({ id, name: id })),
    }
    atomicWrite(filePath, JSON.stringify(document, null, 2))
    return { success: true, message: `已写入 OpenClaw 配置：${filePath}` }
  } catch (error) { return { success: false, message: `OpenClaw 配置写入失败：${error}` } }
}

function getPlatformStatus(config: AppConfig): PlatformStatus[] {
  const home = os.homedir()
  const hermesPath = config.hermes_config_path
  const entries: Array<Omit<PlatformStatus, 'detected'> & { probe: string }> = [
    { id: 'claude-code', name: 'Claude Code', configPath: path.join(home, '.claude', 'settings.json'), probe: path.join(home, '.claude'), supportsMcp: true, supportsPrompts: true, supportsSkills: true },
    { id: 'claude-desktop', name: 'Claude Desktop', configPath: path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json'), probe: path.join(app.getPath('appData'), 'Claude'), supportsMcp: true, supportsPrompts: false, supportsSkills: true },
    { id: 'codex', name: 'Codex', configPath: path.join(home, '.codex', 'config.toml'), probe: path.join(home, '.codex'), supportsMcp: true, supportsPrompts: true, supportsSkills: true },
    { id: 'gemini-cli', name: 'Gemini CLI', configPath: path.join(home, '.gemini', 'settings.json'), probe: path.join(home, '.gemini'), supportsMcp: true, supportsPrompts: true, supportsSkills: true },
    { id: 'grok-build', name: 'Grok Build', configPath: path.join(home, '.grok', 'config.toml'), probe: path.join(home, '.grok'), supportsMcp: true, supportsPrompts: true, supportsSkills: true },
    { id: 'opencode', name: 'OpenCode', configPath: path.join(home, '.config', 'opencode', 'opencode.json'), probe: path.join(home, '.config', 'opencode'), supportsMcp: true, supportsPrompts: true, supportsSkills: true },
    { id: 'openclaw', name: 'OpenClaw', configPath: path.join(home, '.openclaw', 'openclaw.json'), probe: path.join(home, '.openclaw'), supportsMcp: false, supportsPrompts: false, supportsSkills: true },
    { id: 'hermes', name: 'Hermes', configPath: hermesPath || '未选择 config.yaml', probe: hermesPath, supportsMcp: true, supportsPrompts: true, supportsSkills: true },
  ]
  return entries.map(({ probe, ...entry }) => ({ ...entry, detected: Boolean(probe && fs.existsSync(probe)) }))
}

async function exportAppData(): Promise<ApplyResult> {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '导出 Hermes Provider Switcher 数据',
    defaultPath: path.join(app.getPath('documents'), 'hermes-provider-switcher-export.json'),
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { success: false, message: '已取消导出。' }
  const payload = { version: 1, exportedAt: new Date().toISOString(), config: loadConfig(), resources: loadManagedState() }
  atomicWrite(result.filePath, JSON.stringify(payload, null, 2))
  return { success: true, message: `已导出本机配置：${result.filePath}` }
}

async function importAppData(): Promise<ApplyResult> {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '导入 Hermes Provider Switcher 数据',
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths[0]) return { success: false, message: '已取消导入。' }
  try {
    const payload = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')) as { version?: number; config?: AppConfig; resources?: ManagedState }
    if (payload.version !== 1 || !payload.config || !Array.isArray(payload.config.providers) || !payload.resources) {
      return { success: false, message: '导入文件格式无效或版本不受支持。' }
    }
    if (!Array.isArray(payload.resources.mcpServers) || !Array.isArray(payload.resources.prompts) || !Array.isArray(payload.resources.skills)) {
      return { success: false, message: '导入文件中的资源数据不完整。' }
    }
    backupFile(CONFIG_FILE)
    saveManagedState(payload.resources)
    saveConfig(normalizeConfig(payload.config))
    return { success: true, message: '已导入配置和资源库；当前页面将刷新。' }
  } catch (error) {
    return { success: false, message: `导入失败：${error}` }
  }
}

function registerIPC() {
  ipcMain.handle(IPC.GET_CONFIG, () => loadConfig())
  ipcMain.handle(IPC.SAVE_CONFIG, (_e, cfg: AppConfig) => {
    const next = normalizeConfig(cfg)
    saveConfig(next)
    app.setLoginItemSettings({ openAtLogin: next.launch_at_login, openAsHidden: false })
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
  ipcMain.handle(IPC.SELECT_WORKSPACE, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择默认工作区', properties: ['openDirectory', 'createDirectory'] })
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
  })
  ipcMain.handle(IPC.OPEN_WORKSPACE, async (_event, workspacePath: string) => {
    if (!workspacePath || !fs.existsSync(workspacePath)) return { success: false, message: '工作区目录不存在。' }
    const error = await shell.openPath(workspacePath)
    return error ? { success: false, message: `无法打开工作区：${error}` } : { success: true, message: '已打开工作区目录。' }
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
  ipcMain.handle(IPC.GET_MANAGED_STATE, () => loadManagedState())
  ipcMain.handle(IPC.SAVE_MANAGED_STATE, (_event, state: ManagedState) => {
    saveManagedState(state)
    return true
  })
  ipcMain.handle(IPC.SYNC_MCP, (_event, state: ManagedState, hermesConfigPath: string) => syncMcpServers(state, hermesConfigPath))
  ipcMain.handle(IPC.SYNC_PROMPTS, (_event, state: ManagedState) => syncPrompts(state))
  ipcMain.handle(IPC.SYNC_SKILLS, (_event, state: ManagedState) => syncSkills(state))
  ipcMain.handle(IPC.APPLY_CLI_PROVIDER, (_event, platform: 'claude-code' | 'gemini-cli', provider: Provider) => applyProviderToCliPlatform(platform, provider))
  ipcMain.handle(IPC.APPLY_OPENCODE_PROVIDER, (_event, provider: Provider) => applyProviderToOpenCode(provider))
  ipcMain.handle(IPC.APPLY_CODEX_PROVIDER, (_event, provider: Provider) => applyProviderToCodex(provider))
  ipcMain.handle(IPC.APPLY_CLAUDE_DESKTOP_PROVIDER, (_event, provider: Provider) => applyProviderToClaudeDesktop(provider))
  ipcMain.handle(IPC.APPLY_GROK_PROVIDER, (_event, provider: Provider) => applyProviderToGrokBuild(provider))
  ipcMain.handle(IPC.APPLY_OPENCLAW_PROVIDER, (_event, provider: Provider) => applyProviderToOpenClaw(provider))
  ipcMain.handle(IPC.GET_PLATFORM_STATUS, () => getPlatformStatus(loadConfig()))
  ipcMain.handle(IPC.EXPORT_DATA, () => exportAppData())
  ipcMain.handle(IPC.IMPORT_DATA, () => importAppData())
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
