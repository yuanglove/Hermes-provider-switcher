import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppConfig, Provider, ProxyStatus } from '../shared/types'

const emptyProvider = (): Provider => ({
  id: Math.random().toString(36).slice(2, 10),
  name: '新供应商',
  base_url: '',
  api_key: '',
  api_mode: 'chat_completions',
  default_model: '',
  models: [],
  enable_local_proxy: true,
  proxy_port: 15722,
  strip_tools: true,
  custom_headers: [],
  model_mapping: {},
})

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

export default function App() {
  const [config, setConfig] = useState<AppConfig>({ hermes_config_path: '', active_provider_id: null, providers: [] })
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
      setConfig(cfg)
      const id = cfg.active_provider_id || cfg.providers[0]?.id || null
      if (id) selectProvider(id, cfg)
    })
    window.electronAPI.getProxyStatus().then(setProxyStatus)
  }, [])

  const selectedProvider = useMemo(
    () => config.providers.find((p) => p.id === selectedId) || null,
    [config.providers, selectedId],
  )

  const saveConfig = useCallback((next: AppConfig) => {
    setConfig(next)
    window.electronAPI.saveConfig(next)
  }, [])

  function selectProvider(id: string, source = config) {
    const found = source.providers.find((p) => p.id === id)
    setSelectedId(id)
    setDraft(found ? { ...found } : null)
    setModelsText(joinLines(found?.models || []))
    setMappingText(Object.entries(found?.model_mapping || {}).map(([k, v]) => `${k}=${v}`).join('\n'))
    setHeadersText((found?.custom_headers || []).map((h) => `${h.key}=${h.value}`).join('\n'))
  }

  function persistProvider(next: Provider) {
    setDraft(next)
    const providers = config.providers.map((p) => (p.id === next.id ? next : p))
    saveConfig({ ...config, providers })
  }

  function createProvider() {
    const p = emptyProvider()
    const next = { ...config, providers: [...config.providers, p] }
    saveConfig(next)
    selectProvider(p.id, next)
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

  function syncTextFields(provider: Provider): Provider {
    const custom_headers = Object.entries(parseKeyValueLines(headersText)).map(([key, value]) => ({ key, value }))
    return {
      ...provider,
      models: splitLines(modelsText),
      model_mapping: parseKeyValueLines(mappingText),
      custom_headers,
    }
  }

  async function chooseHermesConfig() {
    const path = await window.electronAPI.selectHermesConfig()
    if (path) saveConfig({ ...config, hermes_config_path: path })
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

  async function startProxy() {
    if (!draft) return
    setBusy(true)
    try {
      const provider = syncTextFields(draft)
      persistProvider(provider)
      const status = await window.electronAPI.startProxy(provider)
      setProxyStatus(status)
      setMessage(status.running ? `本地代理已启动：127.0.0.1:${status.port}` : status.error || '代理启动失败')
    } finally {
      setBusy(false)
    }
  }

  async function stopProxy() {
    setBusy(true)
    try {
      const status = await window.electronAPI.stopProxy()
      setProxyStatus(status)
      setMessage('本地代理已停止')
    } finally {
      setBusy(false)
    }
  }

  async function applyToHermes() {
    if (!draft) return
    if (!config.hermes_config_path) {
      setMessage('请先选择 Hermes 的 config.yaml')
      return
    }
    setBusy(true)
    try {
      const provider = syncTextFields(draft)
      persistProvider(provider)
      const result = await window.electronAPI.applyProvider(config.hermes_config_path, provider)
      if (result.success) {
        saveConfig({
          ...config,
          active_provider_id: provider.id,
          providers: config.providers.map((p) => (p.id === provider.id ? provider : p)),
        })
      }
      setMessage(result.message)
    } finally {
      setBusy(false)
    }
  }

  const proxyForSelected = draft && proxyStatus.running && proxyStatus.provider_id === draft.id

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Hermes 供应商切换器</h1>
          <p>管理第三方 API，写入 Hermes 配置，并可通过本地代理做模型映射和请求清洗。</p>
        </div>
        <div className="pathBox">
          <span>{config.hermes_config_path || '尚未选择 Hermes config.yaml'}</span>
          <button className="btn ghost" onClick={chooseHermesConfig}>选择配置</button>
        </div>
      </header>

      <main className="layout">
        <aside className="sidebar">
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
                  {config.active_provider_id === draft.id ? '当前已应用到 Hermes' : '未应用'}
                  {proxyForSelected ? ` · 代理运行中：${proxyStatus.port}` : ''}
                  {selectedProvider ? '' : ''}
                </p>
              </div>
              <button className="btn danger" onClick={() => removeProvider(draft.id)}>删除供应商</button>
            </div>

            <div className="grid">
              <label>
                供应商名称
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => persistProvider(draft)} placeholder="例如 moyyu" />
              </label>
              <label>
                API 模式
                <select value={draft.api_mode} onChange={(e) => { const d = { ...draft, api_mode: e.target.value as Provider['api_mode'] }; setDraft(d); persistProvider(d) }}>
                  <option value="chat_completions">chat_completions</option>
                  <option value="responses">responses</option>
                </select>
              </label>
              <label className="wide">
                Base URL
                <input value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} onBlur={() => persistProvider(draft)} placeholder="https://api.example.com/v1" />
              </label>
              <label className="wide">
                API Key
                <input type="password" value={draft.api_key} onChange={(e) => setDraft({ ...draft, api_key: e.target.value })} onBlur={() => persistProvider(draft)} placeholder="sk-..." />
              </label>
              <label>
                默认模型
                <input value={draft.default_model} onChange={(e) => setDraft({ ...draft, default_model: e.target.value })} onBlur={() => persistProvider(draft)} placeholder="gpt-4o" />
              </label>
              <label>
                代理端口
                <input type="number" value={draft.proxy_port} onChange={(e) => { const d = { ...draft, proxy_port: Number(e.target.value) }; setDraft(d); persistProvider(d) }} />
              </label>
              <label className="wide">
                模型列表（每行一个）
                <textarea value={modelsText} onChange={(e) => setModelsText(e.target.value)} onBlur={() => persistProvider(syncTextFields(draft))} placeholder={'gpt-4o\ngpt-4o-mini'} />
              </label>
              <label className="wide">
                模型映射（每行 Hermes模型=上游模型）
                <textarea value={mappingText} onChange={(e) => setMappingText(e.target.value)} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="gpt-4o=claude-3-5-sonnet" />
              </label>
              <label className="wide">
                自定义请求头（每行 Key=Value）
                <textarea value={headersText} onChange={(e) => setHeadersText(e.target.value)} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="User-Agent=Mozilla/5.0" />
              </label>
            </div>

            <div className="switchRow">
              <label><input type="checkbox" checked={draft.enable_local_proxy} onChange={(e) => { const d = { ...draft, enable_local_proxy: e.target.checked }; setDraft(d); persistProvider(d) }} /> 启用本地代理</label>
              <label><input type="checkbox" checked={draft.strip_tools} onChange={(e) => { const d = { ...draft, strip_tools: e.target.checked }; setDraft(d); persistProvider(d) }} /> 删除 tools/tool_choice 等字段</label>
            </div>

            <div className="actions">
              <button className="btn" onClick={testConnection} disabled={busy || !draft.base_url}>测试连接</button>
              <button className="btn" onClick={fetchModels} disabled={busy || !draft.base_url}>拉取模型</button>
              {!proxyForSelected
                ? <button className="btn" onClick={startProxy} disabled={busy || !draft.enable_local_proxy}>启动代理</button>
                : <button className="btn danger" onClick={stopProxy} disabled={busy}>停止代理</button>}
              <button className="btn primary" onClick={applyToHermes} disabled={busy || !draft.name || !draft.base_url}>应用到 Hermes</button>
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
