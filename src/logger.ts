const SERVICE = "opencode-gitloops"

type LogLevel = "debug" | "info" | "warn" | "error"

interface LogClient {
  app: {
    log(opts: {
      body: {
        service: string
        level: LogLevel
        message: string
        extra?: Record<string, unknown>
      }
    }): Promise<unknown>
  }
}

let _client: LogClient | null = null

/**
 * Initialize the logger with the OpenCode plugin client.
 * Call this once during plugin setup.
 */
export function initLogger(client: LogClient): void {
  _client = client
}

/**
 * Log a structured message via the OpenCode SDK.
 * Silently no-ops if the logger hasn't been initialized yet.
 */
async function log(
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>
): Promise<void> {
  if (!_client) return
  try {
    await _client.app.log({
      body: { service: SERVICE, level, message, ...(extra ? { extra } : {}) },
    })
  } catch {
    // Never let logging failures propagate
  }
}

export const logger = {
  debug: (message: string, extra?: Record<string, unknown>) =>
    log("debug", message, extra),
  info: (message: string, extra?: Record<string, unknown>) =>
    log("info", message, extra),
  warn: (message: string, extra?: Record<string, unknown>) =>
    log("warn", message, extra),
  error: (message: string, extra?: Record<string, unknown>) =>
    log("error", message, extra),
}
