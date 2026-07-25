import { FormEvent, useEffect, useState } from 'react'
import { Download, FileText, RefreshCw, Server, Trash2, Upload, Wrench } from 'lucide-react'
import { ManagedState, PlatformId, Provider } from '../shared/types'

const emptyState: ManagedState = { mcpServers: [], prompts: [], skills: [], usageRecords: [] }
const platforms: Array<{ id: PlatformId; label: string }> = [
  { id: 'claude-code', label: 'Claude Code' }, { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'codex', label: 'Codex' }, { id: 'gemini-cli', label: 'Gemini CLI' },
  { id: 'grok-build', label: 'Grok Build' }, { id: 'opencode', label: 'OpenCode' },
  { id: 'openclaw', label: 'OpenClaw' }, { id: 'hermes', label: 'Hermes' },
]

type ResourceView = 'mcp' | 'prompts' | 'skills'

function selectedPlatforms(form: HTMLFormElement): PlatformId[] {
  return platforms.filter(({ id }) => form.querySelector<HTMLInputElement>(`input[name="platform-${id}"]`)?.checked).map(({ id }) => id)
}

function PlatformChecks() {
  return <fieldset className="platformChecks"><legend>同步平台</legend>{platforms.map(({ id, label }) => <label key={id}><input name={`platform-${id}`} type="checkbox" defaultChecked />{label}</label>)}</fieldset>
}

function useManagedResources() {
  const [state, setState] = useState<ManagedState>(emptyState)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void window.electronAPI.getManagedState().then((data) => setState(data as ManagedState)) }, [])
  async function persist(next: ManagedState) { setState(next); await window.electronAPI.saveManagedState(next) }
  async function run(action: () => Promise<{ message: string }>) { setBusy(true); try { setMessage((await action()).message) } finally { setBusy(false) } }
  return { state, message, busy, persist, run }
}

function ResourceHeader({ eyebrow, title, description, Icon }: { eyebrow: string; title: string; description: string; Icon: typeof Server }) {
  return <><span className="eyebrow">{eyebrow}</span><div className="resourcePageTitle"><div><h2>{title}</h2><p>{description}</p></div><Icon size={25}/></div></>
}

export default function ResourcesPanel({ provider, onNavigate }: { hermesConfigPath: string; provider: Provider | null; onNavigate: (view: ResourceView) => void }) {
  const { state, message, busy, run } = useManagedResources()
  return <section className="utilityWorkspace">
    <ResourceHeader eyebrow="RESOURCES" title="资源中心" description="供应商应用、导入导出与资源入口。MCP、提示词和 Skills 分别在独立页面管理。" Icon={Server} />
    <div className="headerActions resourceActions"><button className="button secondary" disabled={busy} onClick={() => void run(() => window.electronAPI.exportData())}><Download size={16}/>导出数据</button><button className="button secondary" disabled={busy} onClick={() => void run(async () => { const result = await window.electronAPI.importData(); if (result.success) window.setTimeout(() => window.location.reload(), 500); return result })}><Upload size={16}/>导入数据</button></div>
    <section className="settingsCard advancedCard resourceProviderCard"><div className="cardHead"><div><span className="eyebrow">PROVIDERS</span><h2>应用当前供应商</h2><p>{provider ? `当前供应商：${provider.name}` : '请先在供应商页面选择供应商。'}</p></div><Server size={21}/></div><div className="cardFooter resourceProviderActions">
      <button className="button secondary" disabled={!provider || busy} onClick={() => provider && void run(() => window.electronAPI.applyCliProvider('claude-code', provider))}>Claude Code</button><button className="button secondary" disabled={!provider || busy} onClick={() => provider && void run(() => window.electronAPI.applyClaudeDesktopProvider(provider))}>Claude Desktop</button><button className="button secondary" disabled={!provider || busy} onClick={() => provider && void run(() => window.electronAPI.applyCodexProvider(provider))}>Codex</button><button className="button secondary" disabled={!provider || busy} onClick={() => provider && void run(() => window.electronAPI.applyCliProvider('gemini-cli', provider))}>Gemini CLI</button><button className="button secondary" disabled={!provider || busy} onClick={() => provider && void run(() => window.electronAPI.applyGrokProvider(provider))}>Grok Build</button><button className="button secondary" disabled={!provider || busy} onClick={() => provider && void run(() => window.electronAPI.applyOpenCodeProvider(provider))}>OpenCode</button><button className="button secondary" disabled={!provider || busy} onClick={() => provider && void run(() => window.electronAPI.applyOpenClawProvider(provider))}>OpenClaw</button>
    </div></section>
    <div className="resourceLandingGrid">
      <button className="resourceLandingCard" onClick={() => onNavigate('mcp')}><Server size={22}/><strong>MCP 服务器</strong><span>{state.mcpServers.length} 个已保存</span></button>
      <button className="resourceLandingCard" onClick={() => onNavigate('prompts')}><FileText size={22}/><strong>提示词</strong><span>{state.prompts.length} 个已保存</span></button>
      <button className="resourceLandingCard" onClick={() => onNavigate('skills')}><Wrench size={22}/><strong>Skills</strong><span>{state.skills.length} 个已保存</span></button>
    </div>
    {message && <div className="toastMessage">{message}</div>}
  </section>
}

export function McpPanel({ hermesConfigPath }: { hermesConfigPath: string }) {
  const { state, message, busy, persist, run } = useManagedResources()
  const add = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const name = String(data.get('name') || '').trim(); const command = String(data.get('command') || '').trim(); const targets = selectedPlatforms(form); if (!name || !command || !targets.length) return; void persist({ ...state, mcpServers: [...state.mcpServers, { id: crypto.randomUUID(), name, command, args: String(data.get('args') || '').split(' ').filter(Boolean), env: {}, enabledPlatforms: targets }] }); form.reset() }
  return <section className="utilityWorkspace"><ResourceHeader eyebrow="MCP" title="MCP 服务器" description="使用标准 stdio 格式管理本地 MCP 服务器，并同步到支持的客户端。" Icon={Server}/><div className="headerActions resourceActions"><button className="button primary" disabled={busy} onClick={() => void run(() => window.electronAPI.syncMcp(state, hermesConfigPath))}><RefreshCw size={16}/>同步 MCP</button></div><section className="settingsCard advancedCard"><form className="formGrid" onSubmit={add}><label className="formField"><span>名称</span><input name="name" required placeholder="例如 filesystem"/></label><label className="formField"><span>命令</span><input name="command" required placeholder="例如 npx"/></label><label className="formField wide"><span>参数</span><input name="args" placeholder="-y @modelcontextprotocol/server-filesystem D:\\workspace"/></label><PlatformChecks/><button className="button primary" type="submit">保存 MCP</button></form></section><ResourceList items={state.mcpServers} type="mcp" onRemove={(id) => void persist({ ...state, mcpServers: state.mcpServers.filter((item) => item.id !== id) })}/>{message && <div className="toastMessage">{message}</div>}</section>
}

export function PromptsPanel() {
  const { state, message, busy, persist, run } = useManagedResources()
  const add = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const name = String(data.get('name') || '').trim(); const content = String(data.get('content') || '').trim(); const targets = selectedPlatforms(form); if (!name || !content || !targets.length) return; void persist({ ...state, prompts: [...state.prompts, { id: crypto.randomUUID(), name, content, enabledPlatforms: targets }] }); form.reset() }
  return <section className="utilityWorkspace"><ResourceHeader eyebrow="PROMPTS" title="提示词" description="提示词会写入各工具的受管 Markdown 区块，不覆盖用户自行维护的内容。" Icon={FileText}/><div className="headerActions resourceActions"><button className="button primary" disabled={busy} onClick={() => void run(() => window.electronAPI.syncPrompts(state))}><RefreshCw size={16}/>同步提示词</button></div><section className="settingsCard advancedCard"><form className="formGrid" onSubmit={add}><label className="formField"><span>名称</span><input name="name" required placeholder="例如代码审查规则"/></label><label className="formField wide"><span>内容</span><textarea name="content" required placeholder="输入 Markdown 提示词"/></label><PlatformChecks/><button className="button primary" type="submit">保存提示词</button></form></section><ResourceList items={state.prompts} type="prompts" onRemove={(id) => void persist({ ...state, prompts: state.prompts.filter((item) => item.id !== id) })}/>{message && <div className="toastMessage">{message}</div>}</section>
}

export function SkillsPanel() {
  const { state, message, busy, persist, run } = useManagedResources()
  const add = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const name = String(data.get('name') || '').trim(); const sourcePath = String(data.get('sourcePath') || '').trim(); const targets = selectedPlatforms(form); if (!name || !sourcePath || !targets.length) return; void persist({ ...state, skills: [...state.skills, { id: crypto.randomUUID(), name, sourcePath, enabledPlatforms: targets }] }); form.reset() }
  return <section className="utilityWorkspace"><ResourceHeader eyebrow="SKILLS" title="Skills" description="将本机 Skills 目录同步为链接；系统不支持链接时自动复制。" Icon={Wrench}/><div className="headerActions resourceActions"><button className="button primary" disabled={busy} onClick={() => void run(() => window.electronAPI.syncSkills(state))}><RefreshCw size={16}/>同步 Skills</button></div><section className="settingsCard advancedCard"><form className="formGrid" onSubmit={add}><label className="formField"><span>名称</span><input name="name" required placeholder="例如 frontend-design"/></label><label className="formField wide"><span>本机目录</span><input name="sourcePath" required placeholder="D:\\skills\\frontend-design"/></label><PlatformChecks/><button className="button primary" type="submit">保存 Skills</button></form></section><ResourceList items={state.skills} type="skills" onRemove={(id) => void persist({ ...state, skills: state.skills.filter((item) => item.id !== id) })}/>{message && <div className="toastMessage">{message}</div>}</section>
}

function ResourceList({ items, type, onRemove }: { items: Array<{ id: string; name: string; enabledPlatforms: PlatformId[]; command?: string; args?: string[]; sourcePath?: string }>; type: ResourceView; onRemove: (id: string) => void }) {
  const icon = type === 'mcp' ? <Server size={20}/> : type === 'prompts' ? <FileText size={20}/> : <Wrench size={20}/>
  return <div className="resourceItemList">{items.map((item) => <article className="settingsCard resourceItem" key={item.id}><div className="resourceItemIcon">{icon}</div><div><strong>{item.name}</strong><span>{item.command ? `${item.command} ${(item.args || []).join(' ')}` : item.sourcePath || `${item.enabledPlatforms.length} 个同步平台`}</span></div><button className="iconButton" title="删除" onClick={() => onRemove(item.id)}><Trash2 size={17}/></button></article>)}{!items.length && <div className="resourceEmpty">还没有保存的资源。</div>}</div>
}
