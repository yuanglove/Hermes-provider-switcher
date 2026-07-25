export interface ModelMapping {
  [hermesModelName: string]: string
}

export interface CustomHeader {
  key: string
  value: string
}

export type PlatformId = 'claude-code' | 'claude-desktop' | 'codex' | 'gemini-cli' | 'grok-build' | 'opencode' | 'openclaw' | 'hermes'

export interface ManagedMcpServer {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabledPlatforms: PlatformId[]
}

export interface ManagedPrompt {
  id: string
  name: string
  content: string
  enabledPlatforms: PlatformId[]
}

export interface ManagedSkill {
  id: string
  name: string
  sourcePath: string
  enabledPlatforms: PlatformId[]
}

export interface UsageRecord {
  id: string
  timestamp: string
  providerId: string
  providerName: string
  model: string
  status: number
  latencyMs: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export interface ManagedState {
  mcpServers: ManagedMcpServer[]
  prompts: ManagedPrompt[]
  skills: ManagedSkill[]
  usageRecords: UsageRecord[]
}

export interface Provider {
  id: string
  name: string
  base_url: string
  api_key: string
  api_mode: 'chat_completions' | 'responses'
  default_model: string
  models: string[]
  enable_local_proxy: boolean
  proxy_port: number
  strip_tools: boolean
  custom_headers: CustomHeader[]
  model_mapping: ModelMapping
}

export interface AppConfig {
  hermes_config_path: string
  active_provider_id: string | null
  router_port: number
  auto_start_proxy: boolean
  launch_at_login: boolean
  workspace_root: string
  fallback_provider_ids: string[]
  routing_mode: 'proxy' | 'native'
  providers: Provider[]
}

export interface ProxyStatus {
  running: boolean
  port: number
  provider_id: string | null
  provider_name?: string
  error?: string
}

export interface TestConnectionResult {
  success: boolean
  message: string
  models?: string[]
  latency_ms?: number
}

export interface ApplyResult {
  success: boolean
  message: string
  backup_path?: string
}

export interface PlatformStatus {
  id: PlatformId
  name: string
  configPath: string
  detected: boolean
  supportsMcp: boolean
  supportsPrompts: boolean
  supportsSkills: boolean
}

export const IPC = {
  GET_CONFIG: 'get-config',
  SAVE_CONFIG: 'save-config',
  SELECT_HERMES_CONFIG: 'select-hermes-config',
  TEST_CONNECTION: 'test-connection',
  FETCH_MODELS: 'fetch-models',
  APPLY_PROVIDER: 'apply-provider',
  START_PROXY: 'start-proxy',
  STOP_PROXY: 'stop-proxy',
  GET_PROXY_STATUS: 'get-proxy-status',
  GET_MANAGED_STATE: 'get-managed-state',
  SAVE_MANAGED_STATE: 'save-managed-state',
  SYNC_MCP: 'sync-mcp',
  SYNC_PROMPTS: 'sync-prompts',
  SYNC_SKILLS: 'sync-skills',
  APPLY_CLI_PROVIDER: 'apply-cli-provider',
  APPLY_OPENCODE_PROVIDER: 'apply-opencode-provider',
  APPLY_CODEX_PROVIDER: 'apply-codex-provider',
  APPLY_CLAUDE_DESKTOP_PROVIDER: 'apply-claude-desktop-provider',
  APPLY_GROK_PROVIDER: 'apply-grok-provider',
  APPLY_OPENCLAW_PROVIDER: 'apply-openclaw-provider',
  GET_PLATFORM_STATUS: 'get-platform-status',
  EXPORT_DATA: 'export-data',
  IMPORT_DATA: 'import-data',
  SELECT_WORKSPACE: 'select-workspace',
  OPEN_WORKSPACE: 'open-workspace',
  ON_LOG: 'on-log',
} as const
