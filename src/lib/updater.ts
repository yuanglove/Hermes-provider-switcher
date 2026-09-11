import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

export type UpdateChannel = "stable" | "beta";

export interface UpdateInfo {
  currentVersion: string;
  availableVersion: string;
  notes?: string;
  pubDate?: string;
}

export interface CheckOptions {
  timeout?: number;
  channel?: UpdateChannel;
}

const DEFAULT_TIMEOUT_MS = 8000;

async function withDeadline<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("检查更新超时，请稍后重试")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getCurrentVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "";
  }
}

export async function checkForUpdate(
  opts: CheckOptions = {},
): Promise<
  { status: "up-to-date" } | { status: "available"; info: UpdateInfo }
> {
  const timeout = Math.min(
    Math.max(opts.timeout ?? DEFAULT_TIMEOUT_MS, 1000),
    15000,
  );
  const [currentVersion, result] = await withDeadline(
    Promise.all([
      getCurrentVersion(),
      invoke<{
        available_version: string | null;
        notes: string | null;
        date: string | null;
      }>("check_release_update", {
        // Tauri command arguments use camelCase by default, even when the Rust
        // parameter is named timeout_ms.
        timeoutMs: timeout,
      }),
    ]),
    timeout + 500,
  );

  if (!result.available_version) {
    return { status: "up-to-date" };
  }

  const info: UpdateInfo = {
    currentVersion,
    availableVersion: result.available_version,
    notes: result.notes ?? undefined,
    pubDate: result.date ?? undefined,
  };

  return { status: "available", info };
}
