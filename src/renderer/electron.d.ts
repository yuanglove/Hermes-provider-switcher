import { AppConfig, Provider, ProxyStatus, TestConnectionResult, ApplyResult, PlatformStatus } from '../shared/types'

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
      getManagedState: () => Promise<unknown>
      saveManagedState: (state: unknown) => Promise<boolean>
      syncMcp: (state: unknown, hermesConfigPath: string) => Promise<{ success: boolean; message: string }>
      syncPrompts: (state: unknown) => Promise<{ success: boolean; message: string }>
      syncSkills: (state: unknown) => Promise<{ success: boolean; message: string }>
      applyCliProvider: (platform: 'claude-code' | 'gemini-cli', provider: Provider) => Promise<ApplyResult>
      applyOpenCodeProvider: (provider: Provider) => Promise<ApplyResult>
      applyCodexProvider: (provider: Provider) => Promise<ApplyResult>
      applyClaudeDesktopProvider: (provider: Provider) => Promise<ApplyResult>
      applyGrokProvider: (provider: Provider) => Promise<ApplyResult>
      applyOpenClawProvider: (provider: Provider) => Promise<ApplyResult>
      getPlatformStatus: () => Promise<PlatformStatus[]>
      exportData: () => Promise<ApplyResult>
      importData: () => Promise<ApplyResult>
      selectWorkspace: () => Promise<string | null>
      openWorkspace: (workspacePath: string) => Promise<ApplyResult>
    }
  }
}

export {}
