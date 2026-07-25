import { useEffect, useMemo, useState } from 'react'
import { Activity, RefreshCw, Timer, Zap } from 'lucide-react'
import { ManagedState } from '../shared/types'

const emptyState: ManagedState = { mcpServers: [], prompts: [], skills: [], usageRecords: [] }

export default function UsagePanel() {
  const [state, setState] = useState<ManagedState>(emptyState)
  const refresh = () => { void window.electronAPI.getManagedState().then((next) => setState(next as ManagedState)) }
  useEffect(refresh, [])
  const summary = useMemo(() => state.usageRecords.reduce((total, record) => ({
    requests: total.requests + 1,
    tokens: total.tokens + (record.totalTokens || 0),
    latency: total.latency + record.latencyMs,
  }), { requests: 0, tokens: 0, latency: 0 }), [state.usageRecords])
  const averageLatency = summary.requests ? Math.round(summary.latency / summary.requests) : 0

  return <section className="utilityWorkspace">
    <span className="eyebrow">ACTIVITY</span><h2>会话与用量</h2>
    <p>仅记录本地路由请求的元数据与 API 返回的 token 用量，不保存消息正文、响应正文或 API Key。</p>
    <div className="headerActions resourceActions"><button className="button secondary" onClick={refresh}><RefreshCw size={16}/>刷新记录</button></div>
    <div className="utilityGrid">
      <article className="utilityCard"><Activity size={22}/><strong>{summary.requests}</strong><span>本地路由请求</span></article>
      <article className="utilityCard"><Zap size={22}/><strong>{summary.tokens || '-'}</strong><span>已返回 token</span></article>
      <article className="utilityCard"><Timer size={22}/><strong>{averageLatency || '-'} ms</strong><span>平均响应时间</span></article>
    </div>
    <section className="settingsCard advancedCard activityList"><div className="cardHead"><div><span className="eyebrow">RECENT REQUESTS</span><h2>最近请求</h2><p>最多保留 500 条本地记录。</p></div><Activity size={21}/></div>
      {state.usageRecords.length ? <div className="requestTable">{state.usageRecords.slice(0, 100).map((record) => <div className="requestRow" key={record.id}><span>{new Date(record.timestamp).toLocaleString()}</span><strong>{record.providerName}</strong><code>{record.model}</code><span className={record.status < 400 ? 'requestOk' : 'requestFailed'}>{record.status}</span><span>{record.totalTokens ? `${record.totalTokens} tokens` : '-'}</span><span>{record.latencyMs} ms</span></div>)}</div> : <p className="emptyActivity">路由器处理请求后，会在这里显示记录。</p>}
    </section>
  </section>
}
