import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, Provider } from '../shared/types'

const IPC = {
  GET_CONFIG: 'get-config',
  SAVE_CONFIG: 'save-config',
  SELECT_HERMES_CONFIG: 'select-hermes-config',
  TEST_CONNECTION: 'test-connection',
  FETCH_MODELS: 'fetch-models',
  APPLY_PROVIDER: 'apply-provider',
  START_PROXY: 'start-proxy',
  STOP_PROXY: 'stop-proxy',
  GET_PROXY_STATUS: 'get-proxy-status',
} as const

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke(IPC.GET_CONFIG),
  saveConfig: (cfg: AppConfig) => ipcRenderer.invoke(IPC.SAVE_CONFIG, cfg),
  selectHermesConfig: () => ipcRenderer.invoke(IPC.SELECT_HERMES_CONFIG),
  testConnection: (provider: Provider) => ipcRenderer.invoke(IPC.TEST_CONNECTION, provider),
  fetchModels: (provider: Provider) => ipcRenderer.invoke(IPC.FETCH_MODELS, provider),
  applyProvider: (configPath: string, provider: Provider) =>
    ipcRenderer.invoke(IPC.APPLY_PROVIDER, configPath, provider),
  startProxy: (provider: Provider) => ipcRenderer.invoke(IPC.START_PROXY, provider),
  stopProxy: () => ipcRenderer.invoke(IPC.STOP_PROXY),
  getProxyStatus: () => ipcRenderer.invoke(IPC.GET_PROXY_STATUS),
})
