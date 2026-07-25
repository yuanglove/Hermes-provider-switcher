import { useEffect, useMemo, useState } from 'react'
import { Activity, ChevronRight, CircleCheck, CirclePlus, CloudCog, Code2, FolderOpen, Link2, LoaderCircle, Play, PlugZap, Power, RefreshCw, Route, Save, ServerCog, Settings2, ShieldCheck, Trash2, Wifi, Zap } from 'lucide-react'
import { AppConfig, Provider, ProxyStatus } from '../shared/types'

const DEFAULT_PORT = 15722

const emptyProvider = (preset?: Partial<Provider>): Provider => ({
  id: Math.random().toString(36).slice(2, 10),
  name: preset?.name || '新供应商',
  base_url: preset?.base_url || '',
  api_key: '',
  api_mode: 'chat_completions',
  default_model: preset?.default_model || '',
  models: preset?.models || [],
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
  routing_mode: 'proxy',
  providers: [],
}

const providerPresets: Array<Pick<Provider, 'name' | 'base_url' | 'default_model' | 'models'>> = [
  { name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', default_model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', default_model: 'openai/gpt-4o-mini', models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'] },
  { name: '自定义 API', base_url: 'https://api.example.com/v1', default_model: 'gpt-4o', models: ['gpt-4o'] },
]

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
  const [activePanel, setActivePanel] = useState<'providers' | 'router' | 'targets'>('providers')

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
    () => config.providers.find((provider) => provider.id === config.active_provider_id) || null,
    [config.providers, config.active_provider_id],
  )
  const routerBaseUrl = `http://127.0.0.1:${config.router_port || DEFAULT_PORT}/v1`
  const selectedIsActive = !!draft && config.active_provider_id === draft.id

  function saveConfig(next: AppConfig) {
    const normalized = { ...emptyConfig, ...next }
    setConfig(normalized)
    window.electronAPI.saveConfig(normalized)
  }

  function selectProvider(id: string, source = config) {
    const found = source.providers.find((provider) => provider.id === id)
    setSelectedId(id)
    setDraft(found ? { ...found } : null)
    const text = providerToDraftText(found)
    setModelsText(text.modelsText)
    setMappingText(text.mappingText)
    setHeadersText(text.headersText)
  }

  function syncTextFields(provider: Provider): Provider {
    return {
      ...provider,
      models: splitLines(modelsText),
      model_mapping: parseKeyValueLines(mappingText),
      custom_headers: Object.entries(parseKeyValueLines(headersText)).map(([key, value]) => ({ key, value })),
      proxy_port: config.router_port,
      enable_local_proxy: true,
    }
  }

  function persistProvider(next: Provider, makeActive = false) {
    setDraft(next)
    const providers = config.providers.map((provider) => (provider.id === next.id ? next : provider))
    saveConfig({ ...config, providers, active_provider_id: makeActive ? next.id : config.active_provider_id })
  }

  function createProvider(preset?: Partial<Provider>) {
    const provider = emptyProvider(preset)
    const next = {
      ...config,
      active_provider_id: config.active_provider_id || provider.id,
      providers: [...config.providers, provider],
    }
    saveConfig(next)
    selectProvider(provider.id, next)
    setMessage('已创建供应商，请补全连接信息。')
  }

  function removeProvider(id: string) {
    const providers = config.providers.filter((provider) => provider.id !== id)
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
    setProxyStatus(await window.electronAPI.getProxyStatus())
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
        const models = Array.from(new Set([...(provider.models || []), ...result.models]))
        const next = { ...provider, models, default_model: provider.default_model || models[0] || '' }
        setModelsText(joinLines(models))
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
        const models = Array.from(new Set([...(provider.models || []), ...result.models]))
        const next = { ...provider, models, default_model: provider.default_model || models[0] || '' }
        setModelsText(joinLines(models))
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
      setProxyStatus(await window.electronAPI.stopProxy())
      setMessage('本地路由器已停止。')
    } finally {
      setBusy(false)
    }
  }

  async function applyRouterToHermes() {
    if (!draft) return
    if (!config.hermes_config_path) {
      setMessage('请先选择 Hermes 的 config.yaml 文件。')
      return
    }
    setBusy(true)
    try {
      const provider = syncTextFields(draft)
      persistProvider(provider, true)
      const result = await window.electronAPI.applyProvider(config.hermes_config_path, provider)
      setMessage(result.message)
      if (result.success && !proxyStatus.running) setProxyStatus(await window.electronAPI.startProxy({ ...provider, proxy_port: config.router_port }))
    } finally {
      setBusy(false)
    }
  }

  const routerState = proxyStatus.running ? '运行中' : '未启动'

  return (
    <div className="workspace">
      <aside className="appRail">
        <div className="appLogo"><Route size={22} strokeWidth={2.4} /></div>
        <div className="railGroup">
          <button className={`railButton ${activePanel === "providers" ? "active" : ""}`} onClick={() => setActivePanel("providers")} title="供应商工作台"><CloudCog size={19} /></button>
          <button className={`railButton ${activePanel === "router" ? "active" : ""}`} onClick={() => setActivePanel("router")} title="路由设置"><Settings2 size={19} /></button>
        </div>
        <div className="railBottom"><button className={`railButton ${activePanel === "targets" ? "active" : ""}`} onClick={() => setActivePanel("targets")} title="目标应用"><Code2 size={19} /></button></div>
      </aside>

      <aside className="providerSidebar">
        <div className="sidebarHead">
          <div><span className="eyebrow">HERMES</span><h1>API 路由中心</h1></div>
          <button className="iconButton" onClick={() => createProvider()} title="新建供应商"><CirclePlus size={20} /></button>
        </div>

        <div className="routerMiniCard">
          <div className="miniCardTop"><span className={proxyStatus.running ? 'liveDot' : 'idleDot'} /><span>本地路由</span><strong>{routerState}</strong></div>
          <code>{routerBaseUrl}</code>
          <button className="miniAction" onClick={proxyStatus.running ? stopRouter : startRouter} disabled={busy}>
            {proxyStatus.running ? <Power size={15} /> : <Play size={15} />}{proxyStatus.running ? '停止路由' : '启动路由'}
          </button>
        </div>

        <div className="providerSectionHead"><span>供应商</span><span>{config.providers.length}</span></div>
        <div className="providerList">
          {config.providers.map((provider) => (
            <button key={provider.id} className={`providerRow ${provider.id === selectedId ? 'selected' : ''}`} onClick={() => selectProvider(provider.id)}>
              <span className={provider.id === config.active_provider_id ? 'providerState online' : 'providerState'} />
              <span className="providerRowText"><strong>{provider.name || '未命名供应商'}</strong><small>{provider.default_model || '尚未设置模型'}</small></span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>

        <div className="sidebarFoot"><button className="newProviderButton" onClick={() => createProvider()}><CirclePlus size={17} />新建供应商</button></div>
      </aside>

      <main className="consoleMain">
        <header className="consoleHeader">
          <div className="breadcrumb"><span>供应商工作台</span><ChevronRight size={14} /><strong>{draft?.name || '新建连接'}</strong></div>
          <div className="headerActions">
            <button className="textButton" onClick={chooseHermesConfig}><FolderOpen size={16} />{config.hermes_config_path ? '已选择 Hermes 配置' : '选择 Hermes 配置'}</button>
            <button className="button secondary" onClick={refreshProxyStatus}><RefreshCw size={16} />刷新状态</button>
            <button className="button primary" onClick={applyRouterToHermes} disabled={busy || !draft?.name || !draft.base_url}><Zap size={16} />连接 Hermes</button>
          </div>
        </header>

        {activePanel === "router" ? (
          <section className="utilityWorkspace">
            <span className="eyebrow">LOCAL ROUTER</span>
            <h2>本地路由控制</h2>
            <p>Hermes 固定连接本机地址；切换供应商时，无需再次改写 Hermes 配置。</p>
            <div className="utilityGrid">
              <article className="utilityCard"><Route size={22} /><strong>{proxyStatus.running ? "路由器运行中" : "路由器未启动"}</strong><span>{routerBaseUrl}</span><button className="button primary" onClick={proxyStatus.running ? stopRouter : startRouter} disabled={busy}>{proxyStatus.running ? <Power size={16} /> : <Play size={16} />}{proxyStatus.running ? "停止路由" : "启动路由"}</button></article>
              <article className="utilityCard"><FolderOpen size={22} /><strong>Hermes 配置文件</strong><span>{config.hermes_config_path || "尚未选择 config.yaml"}</span><button className="button secondary" onClick={chooseHermesConfig}>选择配置文件</button></article>
              <article className="utilityCard"><Settings2 size={22} /><strong>监听端口</strong><label className="formField"><input type="number" value={config.router_port} onChange={(event) => saveConfig({ ...config, router_port: Number(event.target.value) || DEFAULT_PORT })} /></label><button className="button secondary" onClick={refreshProxyStatus}><RefreshCw size={16} />刷新状态</button></article>
            </div>
          </section>
        ) : activePanel === "targets" ? (
          <section className="utilityWorkspace">
            <span className="eyebrow">TARGET APPLICATIONS</span>
            <h2>目标应用</h2>
            <p>cc-switch 支持的八个平台。当前版本已启用 Hermes 的原生配置与本地路由双模式；其余平台适配器将按各自配置格式逐项接入。</p>
            <div className="targetGrid">
              {[
                ["Claude Code", "命令行版", "settings.json / 环境变量"],
                ["Claude Desktop", "桌面版", "独立 3P 配置"],
                ["Codex", "命令行版", "config.toml / auth.json"],
                ["Gemini CLI", "命令行版", "settings.json"],
                ["Grok Build", "命令行版", "配置文件"],
                ["OpenCode", "命令行版", "opencode.json"],
                ["OpenClaw", "桌面 / CLI", "应用配置"],
                ["Hermes", "桌面 Agent", "config.yaml"],
              ].map(([name, kind, format]) => (
                <article key={name} className={`targetCard ${name === "Hermes" ? "enabled" : ""}`}><Code2 size={19} /><div><strong>{name}</strong><span>{kind}</span><small>{format}</small></div><em>{name === "Hermes" ? "已启用" : "适配中"}</em></article>
              ))}
            </div>
          </section>
        ) : !draft ? (
          <section className="emptyWorkspace">
            <div className="emptyGlyph"><PlugZap size={34} /></div>
            <span className="eyebrow">开始配置</span>
            <h2>创建你的第一个 API 连接</h2>
            <p>添加供应商后，Hermes 会稳定连接本地路由地址；以后只需在此处切换上游模型。</p>
            <div className="templateCards">
              {providerPresets.map((preset) => <button key={preset.name} className="templateCard" onClick={() => createProvider(preset)}><CloudCog size={19} /><strong>{preset.name}</strong><span>{preset.default_model}</span></button>)}
            </div>
          </section>
        ) : (
          <section className="providerWorkspace">
            <div className="providerHero">
              <div className="providerIcon"><CloudCog size={25} /></div>
              <div className="providerIdentity">
                <div className="identityLine"><input aria-label="供应商名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} onBlur={() => persistProvider(syncTextFields(draft))} /><span className={selectedIsActive ? 'activeBadge' : 'idleBadge'}>{selectedIsActive ? '当前正在使用' : '待切换'}</span></div>
                <p>{draft.base_url || '请填写上游 API 地址。'} </p>
              </div>
              <div className="heroActions"><button className="button secondary" onClick={testConnection} disabled={busy || !draft.base_url}>{busy ? <LoaderCircle className="spin" size={16} /> : <Wifi size={16} />}测试连接</button><button className="button primary" onClick={activateProvider} disabled={busy || !draft.name}><CircleCheck size={16} />设为当前</button></div>
            </div>

            <div className="healthGrid">
              <article className="healthCard"><div className="healthIcon indigo"><Route size={18} /></div><div><span>路由状态</span><strong>{routerState}</strong><small>127.0.0.1:{config.router_port}</small></div></article>
              <article className="healthCard"><div className="healthIcon emerald"><ServerCog size={18} /></div><div><span>当前上游</span><strong>{activeProvider?.name || '尚未选择'}</strong><small>{activeProvider?.default_model || '未设置模型'}</small></div></article>
              <article className="healthCard"><div className="healthIcon amber"><Activity size={18} /></div><div><span>可用模型</span><strong>{draft.models.length}</strong><small>可通过 API 自动拉取</small></div></article>
            </div>

            <div className="contentGrid">
              <section className="settingsCard connectionCard">
                <div className="cardHead"><div><span className="eyebrow">CONNECTION</span><h2>连接设置</h2><p>用于安全连接第三方 OpenAI 兼容 API。</p></div><ShieldCheck size={21} /></div>
                <div className="formGrid">
                  <label className="formField wide"><span>Base URL</span><div className="inputWithIcon"><Link2 size={16} /><input value={draft.base_url} onChange={(event) => setDraft({ ...draft, base_url: event.target.value })} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="https://api.example.com/v1" /></div></label>
                  <label className="formField wide"><span>API Key</span><input type="password" value={draft.api_key} onChange={(event) => setDraft({ ...draft, api_key: event.target.value })} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="填入 API Key，仅保存在本机" /></label>
                  <label className="formField"><span>接口模式</span><select value={draft.api_mode} onChange={(event) => { const next = { ...draft, api_mode: event.target.value as Provider['api_mode'] }; setDraft(next); persistProvider(syncTextFields(next)) }}><option value="chat_completions">Chat Completions</option><option value="responses">Responses</option></select></label>
                  <label className="formField"><span>默认模型</span><input value={draft.default_model} onChange={(event) => setDraft({ ...draft, default_model: event.target.value })} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="例如 deepseek-chat" /></label>
                </div>
                <div className="cardFooter"><button className="button ghost" onClick={fetchModels} disabled={busy || !draft.base_url}><RefreshCw size={16} />拉取模型</button><button className="button secondary" onClick={() => persistProvider(syncTextFields(draft))}><Save size={16} />保存连接</button></div>
              </section>

              <section className="settingsCard routerCard">
                <div className="cardHead"><div><span className="eyebrow">ROUTER</span><h2>路由策略</h2><p>Hermes 固定访问本地地址，上游随当前供应商切换。</p></div><Route size={21} /></div>
                <label className="formField"><span>接入模式</span><select value={config.routing_mode} onChange={(event) => saveConfig({ ...config, routing_mode: event.target.value as AppConfig['routing_mode'] })}><option value="proxy">本地路由增强</option><option value="native">Hermes 原生直连</option></select></label>
                <label className="formField"><span>本地端口</span><input type="number" value={config.router_port} onChange={(event) => saveConfig({ ...config, router_port: Number(event.target.value) || DEFAULT_PORT })} /></label>
                <div className="modeHint">{config.routing_mode === 'native' ? '原生直连会保留多个 Hermes 供应商；模型映射、自定义请求头与字段清洗请使用本地路由模式。' : '本地路由支持模型映射、自定义请求头和兼容字段清洗，适合第三方接口。'}</div>
                <label className="toggleLine"><input type="checkbox" checked={config.auto_start_proxy} onChange={(event) => saveConfig({ ...config, auto_start_proxy: event.target.checked })} /><span className="toggleControl" /><span><strong>启动应用时自动运行路由</strong><small>建议保持开启，确保 Hermes 可随时访问。</small></span></label>
                <label className="toggleLine"><input type="checkbox" checked={draft.strip_tools} onChange={(event) => { const next = { ...draft, strip_tools: event.target.checked }; setDraft(next); persistProvider(syncTextFields(next)) }} /><span className="toggleControl" /><span><strong>兼容模式</strong><small>删除 tools、tool_choice 等上游不支持字段。</small></span></label>
                <div className="routerEndpoint"><span>Hermes 连接地址</span><code>{routerBaseUrl}</code></div>
              </section>
            </div>

            <section className="settingsCard advancedCard">
              <div className="cardHead"><div><span className="eyebrow">ADVANCED</span><h2>模型与请求适配</h2><p>模型列表用于向 Hermes 公开能力；映射和请求头会在本地路由中应用。</p></div><Settings2 size={21} /></div>
              <div className="formGrid advancedGrid">
                <label className="formField"><span>模型列表 <small>每行一个</small></span><textarea value={modelsText} onChange={(event) => setModelsText(event.target.value)} onBlur={() => persistProvider(syncTextFields(draft))} placeholder={'deepseek-chat\ndeepseek-reasoner'} /></label>
                <label className="formField"><span>模型映射 <small>Hermes模型=上游模型</small></span><textarea value={mappingText} onChange={(event) => setMappingText(event.target.value)} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="gpt-4o=deepseek-chat" /></label>
                <label className="formField"><span>自定义请求头 <small>Key=Value</small></span><textarea value={headersText} onChange={(event) => setHeadersText(event.target.value)} onBlur={() => persistProvider(syncTextFields(draft))} placeholder="HTTP-Referer=https://example.com" /></label>
              </div>
              <div className="dangerZone"><div><strong>删除此供应商</strong><span>删除后本机保存的该供应商配置将无法恢复。</span></div><button className="button danger" onClick={() => removeProvider(draft.id)}><Trash2 size={16} />删除</button></div>
            </section>

            {message && <div className="toastMessage"><CircleCheck size={17} /><span>{message}</span></div>}
          </section>
        )}
      </main>
    </div>
  )
}
