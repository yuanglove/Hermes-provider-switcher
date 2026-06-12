import { useEffect, useMemo, useState } from 'react'
import { AppConfig, Provider, ProxyStatus } from '../shared/types'

const DEFAULT_PORT = 15722

const emptyProvider = (): Provider => ({
  id: Math.random().toString(36).slice(2, 10),
  name: '新供应商',
  base_url: '',
  api_key: '',
  api_mode: 'chat_completions',
  default_model: '',
  models: [],
  enable_local_proxy: true,
  proxy_port: DEFAULT_PORT,
  strip_tools: true,
  custom_headers: [],
  model_mapping: {},
})

const emptyConfig: AppConfig = {
  hermes_config_path: '',
  active_provider_id: null,
  router_port: DEFAULT_PORT,
  auto_start_proxy: true,
  providers: [],
}

function splitLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function joinLines(value: string[]): string {
  return (value || []).join('\n')
}

function parseKeyValueLines(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of splitLines(value)) {
    const [key, ...rest] = line.split('=')
    const cleanKey = key?.trim()
    const cleanValue = rest.join('=').trim()
    if (cleanKey && cleanValue) result[cleanKey] = cleanValue
  }
  return result
}

function providerToDraftText(provider?: Provider | null) {
  return {
    modelsText: joinLines(provider?.models || []),
    mappingText: Object.entries(provider?.model_mapping || {}).map(([k, v]) => `${k}=${v}`).join('\n'),
    headersText: (provider?.custom_headers || []).map((h) => `${h.key}=${h.value}`).join('\n'),
  }
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>(emptyConfig)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Provider | null>(null)
  const [modelsText, setModelsText] = useState('')
  const [mappingText, setMappingText] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus>({ running: false, port: 0, provider_id: null })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.electronAPI.getConfig().then((cfg) => {
      const next = { ...emptyConfig, ...cfg }
      setConfig(next)
      const id = next.active_provider_id || next.providers[0]?.id || null
      if (id) selectProvider(id, next)
    })
    refreshProxyStatus()
  }, [])

  const activeProvider = useMemo(
    () => config.providers.find((p) => p.id === config.active_provider_id) || null,
    [config.providers, config.active_provider_id],
  )

  function saveConfig(next: AppConfig) {
    const normalized = { ...emptyConfig, ...next }
    setConfig(normalized)
    window.electronAPI.saveConfig(normalized)
  }

  function selectProvider(id: string, source = config) {
    const found = source.providers.find((p) => p.id === id)
    setSelectedId(id)
    setDraft(found ? { ...found } : null)
    const text = providerToDraftText(found)
    setModelsText(text.modelsText)
    setMappingText(text.mappingText)
    setHeadersText(text.headersText)
  }

  function syncTextFields(provider: Provider): Provider {
    const custom_headers = Object.entries(parseKeyValueLines(headersText)).map(([key, value]) => ({ key, value }))
    return {
      ...provider,
      models: splitLines(modelsText),
      model_mapping: parseKeyValueLines(mappingText),
      custom_headers,
      proxy_port: config.router_port,
      enable_local_proxy: true,
    }
  }

  function persistProvider(next: Provider, makeActive = false) {
    setDraft(next)
    const providers = config.providers.map((p) => (p.id === next.id ? next : p))
    saveConfig({
      ...config,
      providers,
      active_provider_id: makeActive ? next.id : config.active_provider_id,
    })
  }

  function createProvider() {
    const provider = emptyProvider()
    const next = {
      ...config,
      active_provider_id: config.active_provider_id || provider.id,
      providers: [...config.providers, provider],
    }
    saveConfig(next)
    selectProvider(provider.id, next)
  }

  function removeProvider(id: string) {
    const providers = config.providers.filter((p) => p.id !== id)
    const active = config.active_provider_id === id ? providers[0]?.id || null : config.active_provider_id
    const next = { ...config, providers, active_provider_id: active }
    saveConfig(next)
    if (providers[0]) selectProvider(providers[0].id, next)
    else {
      setSelectedId(null)
      setDraft(null)
    }
  }

  async function chooseHermesConfig() {
    const path = await window.electronAPI.selectHermesConfig()
    if (path) saveConfig({ ...config, hermes_config_path: path })
  }

  async function refreshProxyStatus() {
    const status = await window.electronAPI.getProxyStatus()
    setProxyStatus(status)
  }

  async function activateProvider() {
    if (!draft) return
    const provider = syncTextFields(draft)
    persistProvider(provider, true)
    setMessage(`已切换到供应商：${provider.name}`)
    setTimeout(refreshProxyStatus, 200)
  }

  async function testConnection() {
    if (!draft) return
    setBusy(true)
    try {
      const provider = syncTextFields(draft)
      persistProvider(provider)
      const result = await window.electronAPI.testConnection(provider)
      if (result.models?.length) {
        const nextModels = Array.from(new Set([...(provider.models || []), ...result.models]))
        const next = { ...provider, models: nextModels, default_model: provider.default_model || nextModels[0] || '' }
        setModelsText(joinLines(nextModels))
        persistProvider(next)
      }
      setMessage(result.message)
    } finally {
      setBusy(false)
    }
  }

  async function fetchModels() {
    if (!draft) return
    setBusy(true)
    try {
      const provider = syncTextFields(draft)
      const result = await window.electronAPI.fetchModels(provider)
      if (result.success && result.models?.length) {
        const nextModels = Array.from(new Set([...(provider.models || []), ...result.models]))
        const next = { ...provider, models: nextModels, default_model: provider.default_model || nextModels[0] || '' }
        setModelsText(joinLines(nextModels))
        persistProvider(next)
      }
      setMessage(result.message)
    } finally {
      setBusy(false)
    }
  }

  async function startRouter() {
    setBusy(true)
    try {
      const status = await window.electronAPI.startProxy({ ...(draft || emptyProvider()), proxy_port: config.router_port })
      setProxyStatus(status)
      setMessage(status.running ? `本地路由器已启动：127.0.0.1:${status.port}` : status.error || '本地路由器启动失败')
    } finally {
      setBusy(false)
    }
  }

  async function stopRouter() {
    setBusy(true)
    try {
      const status = await window.electronAPI.stopProxy()
      setProxyStatus(status)
      setMessage('本地路由器已停止')
    } finally {
      setBusy(false)
    }
  }

  async function applyRouterToHermes() {
    if (!draft) return
    if (!config.hermes_config_path) {
      setMessage('请先选择 Hermes 的 config.yaml')
      return
    }
    setBusy(true)
    try {
      const provider = syncTextFields(draft)
      persistProvider(provider, true)
      const result = await window.electronAPI.applyProvider(config.hermes_config_path, provider)
      setMessage(result.message)
      if (result.success && !proxyStatus.running) {
        const status = await window.electronAPI.startProxy({ ...provider, proxy_port: config.router_port })
        setProxyStatus(status)
      }
    } finally {
      setBusy(false)
    }
  }

  const routerBaseUrl = `http://127.0.0.1:${config.router_port || DEFAULT_PORT}/v1`
  const selectedIsActive = !!draft && config.active_provider_id === draft.id

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Hermes API Router</h1>
          <p>Hermes 固定连接本地路由器；你在这里切换供应商，下一次请求立即走新的 API。</p>
        </div>
        <div className="pathBox">
          <span>{config.hermes_config_path || '尚未选择 Hermes config.yaml'}</span>
          <button className="btn ghost" onClick={chooseHermesConfig}>选择配置</button>
        </div>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <div className={`routerCard ${proxyStatus.running ? 'ok' : ''}`}>
            <strong>{proxyStatus.running ? '路由器运行中' : '路由器未启动'}</strong>
            <span>{routerBaseUrl}</span>
            <small>当前：{activeProvider?.name || '未选择供应商'}</small>
          </div>

          <label className="sideLabel">
            路由端口
            <input
              type="number"
              value={config.router_port}
              onChange={(e) => saveConfig({ ...config, router_port: Number(e.target.value) || DEFAULT_PORT })}
            />
          </label>
          <label className="checkLine">
            <input
              type="checkbox"
              checked={config.auto_start_proxy}
              onChange={(e) => saveConfig({ ...config, auto_start_proxy: e.target.checked })}
            />
            软件启动时自动启动路由器
          </label>

          <button className="btn primary full" onClick={createProvider}>新建供应商</button>
          <div className="providerList">
            {config.providers.map((p) => (
              <button key={p.id} className={`providerItem ${p.id === selectedId ? 'selected' : ''}`} onClick={() => selectProvider(p.id)}>
                <span className={`dot ${config.active_provider_id === p.id ? 'active' : ''}`} />
                <span className="providerName">{p.name || '未命名'}</span>
                <span className="providerModel">{p.default_model || '-'}</span>
              </button>
            ))}
          </div>
        </aside>

        {draft ? (
          <section className="panel">
            <div className="panelHead">
              <div>
                <h2>{draft.name || '未命名供应商'}</h2>
                <p>
                  {selectedIsActive ? '当前激活供应商' : '未激活'}
                  {proxyStatus.running ? ` · 路由器端口：${proxyStatus.port}` : ''}
                </p>
              </div>
              <button className="btn danger" onClick={() => removeProvider(draft.id)}>删除供应商</button>
            </div>

            <div className="grid">
              <label>
                供应商名称
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="例如 DeepSeek" />
              </label>
              <label>
                API 模式
                <select value={draft.api_mode} onChange={(e) => { const d = { ...draft, api_mode: e.target.value as Provider['api_mode'] }; setDraft(d); persistProvider(syncTextFields(d)) }}>
                  <option value="chat_completions">chat_completions</option>
                  <option value="responses">responses</option>
                </select>
              </label>
              <label className="wide">
                Base URL
                <input value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="https://api.example.com/v1" />
              </label>
              <label className="wide">
                API Key
                <input type="password" value={draft.api_key} onChange={(e) => setDraft({ ...draft, api_key: e.target.value })} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="填入你的 API Key" />
              </label>
              <label>
                默认模型
                <input value={draft.default_model} onChange={(e) => setDraft({ ...draft, default_model: e.target.value })} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="deepseek-chat" />
              </label>
              <label>
                字段清洗
                <select value={draft.strip_tools ? 'on' : 'off'} onChange={(e) => { const d = { ...draft, strip_tools: e.target.value === 'on' }; setDraft(d); persistProvider(syncTextFields(d)) }}>
                  <option value="on">删除 tools/tool_choice 等字段</option>
                  <option value="off">保持原始请求</option>
                </select>
              </label>
              <label className="wide">
                模型列表（每行一个）
                <textarea value={modelsText} onChange={(e) => setModelsText(e.target.value)} onBlur={() => persistProvider(syncTextFields(draft))} placeholder={'gpt-4o\ngpt-4o-mini'} />
              </label>
              <label className="wide">
                模型映射（每行 Hermes模型=上游模型）
                <textarea value={mappingText} onChange={(e) => setMappingText(e.target.value)} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="gpt-4o=deepseek-chat" />
              </label>
              <label className="wide">
                自定义请求头（每行 Key=Value）
                <textarea value={headersText} onChange={(e) => setHeadersText(e.target.value)} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="User-Agent=Mozilla/5.0" />
              </label>
            </div>

            <div className="actions">
              <button className="btn" onClick={testConnection} disabled={busy || !draft.base_url}>测试连接</button>
              <button className="btn" onClick={fetchModels} disabled={busy || !draft.base_url}>拉取模型</button>
              <button className="btn" onClick={activateProvider} disabled={busy || !draft.name}>设为当前供应商</button>
              {!proxyStatus.running
                ? <button className="btn" onClick={startRouter} disabled={busy}>启动路由器</button>
                : <button className="btn danger" onClick={stopRouter} disabled={busy}>停止路由器</button>}
              <button className="btn primary" onClick={applyRouterToHermes} disabled={busy || !draft.name || !draft.base_url}>初始化 Hermes 路由</button>
            </div>

            {message && <div className="message">{message}</div>}
          </section>
        ) : (
          <div className="empty">请从左侧选择供应商，或点击“新建供应商”。</div>
        )}
      </main>
    </div>
  )
}
