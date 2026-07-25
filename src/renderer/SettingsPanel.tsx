import { useState } from 'react'
import { CircleCheck, FolderKanban, FolderOpen, GitFork, Info, MonitorCog, Route, Settings2 } from 'lucide-react'
import { AppConfig, ProxyStatus } from '../shared/types'

type SettingsPanelProps = {
  config: AppConfig
  proxyStatus: ProxyStatus
  routerBaseUrl: string
  onSaveConfig: (config: AppConfig) => void
  onChooseHermesConfig: () => void
  onChooseWorkspace: () => void
  onOpenWorkspace: () => void
}

type SettingsTab = 'general' | 'router' | 'about'

const DEFAULT_PORT = 15722

export default function SettingsPanel({
  config,
  proxyStatus,
  routerBaseUrl,
  onSaveConfig,
  onChooseHermesConfig,
  onChooseWorkspace,
  onOpenWorkspace,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('general')

  return <section className="settingsWorkspace">
    <div className="settingsPageHead">
      <div><span className="eyebrow">SETTINGS</span><h2>设置</h2><p>管理本机工作区、Hermes 接入方式和本地路由行为。</p></div>
    </div>
    <div className="settingsLayout">
      <nav className="settingsNav" aria-label="设置分类">
        <button className={tab === 'general' ? 'selected' : ''} onClick={() => setTab('general')}><Settings2 size={17} />通用</button>
        <button className={tab === 'router' ? 'selected' : ''} onClick={() => setTab('router')}><Route size={17} />本地路由</button>
        <button className={tab === 'about' ? 'selected' : ''} onClick={() => setTab('about')}><Info size={17} />关于本项目</button>
      </nav>

      <div className="settingsContent">
        {tab === 'general' && <>
          <section className="settingsCard settingsSection">
            <div className="cardHead"><div><span className="eyebrow">HERMES</span><h2>Hermes 配置</h2><p>选择 Hermes 的 config.yaml 后，可从目标应用页一键应用当前供应商。</p></div><MonitorCog size={21} /></div>
            <div className="pathControl"><code>{config.hermes_config_path || '尚未选择 Hermes 配置文件'}</code><button className="button secondary" onClick={onChooseHermesConfig}><FolderOpen size={16} />选择配置文件</button></div>
          </section>

          <section className="settingsCard settingsSection">
            <div className="cardHead"><div><span className="eyebrow">WORKSPACE</span><h2>默认工作区</h2><p>仅保存本机常用项目目录，方便管理 MCP、提示词和 Skills。</p></div><FolderKanban size={21} /></div>
            <div className="pathControl"><code>{config.workspace_root || '尚未选择默认工作区'}</code><div className="inlineActions"><button className="button secondary" onClick={onChooseWorkspace}>选择目录</button><button className="button" disabled={!config.workspace_root} onClick={onOpenWorkspace}>打开目录</button></div></div>
          </section>

          <section className="settingsCard settingsSection">
            <div className="cardHead"><div><span className="eyebrow">STARTUP</span><h2>启动方式</h2><p>控制应用在 Windows 登录后的启动行为。</p></div></div>
            <label className="toggleLine"><input type="checkbox" checked={config.launch_at_login} onChange={(event) => onSaveConfig({ ...config, launch_at_login: event.target.checked })} /><span className="toggleControl" /><span><strong>随 Windows 启动</strong><small>登录 Windows 后自动启动 Hermes Provider Switcher。</small></span></label>
          </section>
        </>}

        {tab === 'router' && <>
          <section className="settingsCard settingsSection">
            <div className="cardHead"><div><span className="eyebrow">LOCAL ROUTER</span><h2>路由接入</h2><p>本地路由可提供模型映射、自定义请求头、兼容字段清理和故障切换。</p></div><Route size={21} /></div>
            <div className="formGrid">
              <label className="formField"><span>接入模式</span><select value={config.routing_mode} onChange={(event) => onSaveConfig({ ...config, routing_mode: event.target.value as AppConfig['routing_mode'] })}><option value="proxy">本地路由增强</option><option value="native">Hermes 原生直连</option></select></label>
              <label className="formField"><span>本地端口</span><input type="number" min="1024" max="65535" value={config.router_port} onChange={(event) => onSaveConfig({ ...config, router_port: Number(event.target.value) || DEFAULT_PORT })} /></label>
            </div>
            <div className="modeHint">{config.routing_mode === 'native' ? '原生直连保留 Hermes 的供应商配置；模型映射、请求头和兼容字段处理请使用本地路由模式。' : 'Hermes 使用固定的本地地址，切换供应商时无需重复修改 Hermes 配置。'}</div>
            <div className="routerEndpoint"><span>当前路由地址 {proxyStatus.running ? '（运行中）' : '（未启动）'}</span><code>{routerBaseUrl}</code></div>
          </section>

          <section className="settingsCard settingsSection">
            <div className="cardHead"><div><span className="eyebrow">RELIABILITY</span><h2>自动化与故障切换</h2><p>失败时按选择顺序重试备用供应商。</p></div></div>
            <label className="formField"><span>备用供应商 <small>可按 Ctrl 或 Shift 多选</small></span><select multiple value={config.fallback_provider_ids} onChange={(event) => onSaveConfig({ ...config, fallback_provider_ids: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) })}>{config.providers.filter((provider) => provider.id !== config.active_provider_id).map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
            <label className="toggleLine"><input type="checkbox" checked={config.auto_start_proxy} onChange={(event) => onSaveConfig({ ...config, auto_start_proxy: event.target.checked })} /><span className="toggleControl" /><span><strong>启动应用时自动运行路由</strong><small>保持开启可确保 Hermes 打开后能直接访问本地地址。</small></span></label>
          </section>
        </>}

        {tab === 'about' && <section className="settingsCard settingsSection aboutProject">
          <div className="aboutMark"><Route size={30} strokeWidth={2.4} /></div>
          <div><span className="eyebrow">HERMES PROVIDER SWITCHER</span><h2>关于本项目</h2><p>为 Hermes 与常用 AI 应用统一管理第三方模型供应商、路由和本地资源。</p></div>
          <dl className="aboutDetails"><div><dt>当前版本</dt><dd>v0.2.0</dd></div><div><dt>技术栈</dt><dd>Electron · React · TypeScript · Vite</dd></div><div><dt>本地数据</dt><dd>供应商密钥与配置仅保存在本机</dd></div></dl>
          <a className="button secondary aboutLink" href="https://github.com/yuanglove/Hermes-provider-switcher" target="_blank" rel="noreferrer"><GitFork size={16} />GitHub 仓库</a>
          <div className="aboutNotice"><CircleCheck size={17} />支持 Hermes、Claude Code、Claude Desktop、Codex、Gemini CLI、Grok Build、OpenCode 与 OpenClaw。</div>
        </section>}
      </div>
    </div>
  </section>
}
