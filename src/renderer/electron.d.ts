import { AppConfig, Provider, ProxyStatus, TestConnectionResult, ApplyResult } from '../shared/types'

declare global {
  interface Window {
    electronAPI: {
      getConfig: () => Promise<AppConfig>
      saveConfig: (cfg: AppConfig) => Promise<boolean>
      selectHermesConfig: () => Promise<string | null>
      testConnection: (p: Provider) => Promise<TestConnectionResult>
      fetchModels: (p: Provider) => Promise<TestConnectionResult>
      applyProvider: (configPath: string, p: Provider) => Promise<ApplyResult>
      startProxy: (p: Provider) => Promise<ProxyStatus>
      stopProxy: () => Promise<ProxyStatus>
      getProxyStatus: () => Promise<ProxyStatus>
    }
  }
}

export {}
