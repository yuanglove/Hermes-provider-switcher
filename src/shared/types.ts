export interface ModelMapping {
  [hermesModelName: string]: string
}

export interface CustomHeader {
  key: string
  value: string
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
  ON_LOG: 'on-log',
} as const
