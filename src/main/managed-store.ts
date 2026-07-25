import fs from 'fs'
import path from 'path'
import os from 'os'

import { ManagedState, UsageRecord } from '../shared/types'

const STORE_DIR = path.join(os.homedir(), '.hermes-provider-switcher')
const STORE_FILE = path.join(STORE_DIR, 'managed-data.json')
const BACKUP_DIR = path.join(STORE_DIR, 'backups')

const EMPTY_STATE: ManagedState = { mcpServers: [], prompts: [], skills: [], usageRecords: [] }

export function loadManagedState(): ManagedState {
  try {
    if (!fs.existsSync(STORE_FILE)) return { ...EMPTY_STATE }
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as Partial<ManagedState>
    return {
      mcpServers: Array.isArray(parsed.mcpServers) ? parsed.mcpServers : [],
      prompts: Array.isArray(parsed.prompts) ? parsed.prompts : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      usageRecords: Array.isArray(parsed.usageRecords) ? parsed.usageRecords : [],
    }
  } catch {
    return { ...EMPTY_STATE }
  }
}

export function appendUsageRecord(record: UsageRecord): void {
  const current = loadManagedState()
  const next: ManagedState = { ...current, usageRecords: [record, ...current.usageRecords].slice(0, 500) }
  fs.mkdirSync(STORE_DIR, { recursive: true })
  const tmp = `${STORE_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(tmp, STORE_FILE)
}

export function saveManagedState(next: ManagedState): void {
  fs.mkdirSync(STORE_DIR, { recursive: true })
  if (fs.existsSync(STORE_FILE)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(STORE_FILE, path.join(BACKUP_DIR, `managed-data-${stamp}.json`))
  }
  const tmp = `${STORE_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(tmp, STORE_FILE)
}

export function backupFile(source: string): string | undefined {
  if (!fs.existsSync(source)) return undefined
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destination = path.join(BACKUP_DIR, `${path.basename(source)}.${stamp}.bak`)
  if (fs.statSync(source).isDirectory()) fs.cpSync(source, destination, { recursive: true })
  else fs.copyFileSync(source, destination)
  return destination
}

export function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.hermes-provider-switcher.tmp`
  fs.writeFileSync(temporary, content, 'utf8')
  fs.renameSync(temporary, filePath)
}
