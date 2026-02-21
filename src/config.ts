import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { logger } from "./logger"

export type EvictionStrategy = "lru" | "fifo" | "largest"

export interface GitloopsConfig {
  max_repos: number
  cache_loc: string
  eviction_strategy: EvictionStrategy
}

const SCHEMA_URL =
  "https://raw.githubusercontent.com/maharshi-me/gitloops/main/schema/config.schema.json"

const CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "plugin",
  "gitloops.json"
)

const DEFAULT_CACHE_LOC = path.join(os.homedir(), ".cache", "gitloops", "repos")

const DEFAULTS: GitloopsConfig = {
  max_repos: 10,
  cache_loc: DEFAULT_CACHE_LOC,
  eviction_strategy: "lru",
}

/**
 * Resolve ~ to the user's home directory.
 */
function resolvePath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1))
  }
  return path.resolve(p)
}

let _cached: GitloopsConfig | null = null

/**
 * Load the config from disk and merge with defaults.
 * Result is cached after the first call.
 */
export async function getConfig(): Promise<GitloopsConfig> {
  if (_cached) return _cached

  let raw: Partial<GitloopsConfig> = {}

  try {
    const contents = await fs.readFile(CONFIG_PATH, "utf8")
    raw = JSON.parse(contents)
  } catch (err: any) {
    // Distinguish between missing file and invalid JSON
    if (err?.code === "ENOENT") {
      await logger.debug("Config file not found, using defaults", {
        path: CONFIG_PATH,
      })
    } else {
      await logger.warn("Config file has invalid JSON, falling back to defaults", {
        path: CONFIG_PATH,
        error: err?.message || String(err),
      })
    }
  }

  const merged: GitloopsConfig = {
    max_repos:
      typeof raw.max_repos === "number" && raw.max_repos >= 1
        ? raw.max_repos
        : DEFAULTS.max_repos,
    cache_loc: raw.cache_loc
      ? resolvePath(raw.cache_loc)
      : DEFAULTS.cache_loc,
    eviction_strategy:
      raw.eviction_strategy &&
      ["lru", "fifo", "largest"].includes(raw.eviction_strategy)
        ? raw.eviction_strategy
        : DEFAULTS.eviction_strategy,
  }

  _cached = merged

  await logger.info("Config loaded", {
    max_repos: merged.max_repos,
    cache_loc: merged.cache_loc,
    eviction_strategy: merged.eviction_strategy,
  })

  return merged
}

/**
 * Reset the cached config so the next getConfig() call re-reads from disk.
 */
export function resetConfigCache(): void {
  _cached = null
}

/**
 * Create the config file with defaults if it doesn't already exist.
 * Returns true if a new file was created, false if it already existed.
 */
export async function ensureConfigFile(): Promise<boolean> {
  try {
    await fs.access(CONFIG_PATH)
    return false // already exists
  } catch {
    // File doesn't exist — create it
  }

  const configDir = path.dirname(CONFIG_PATH)
  await fs.mkdir(configDir, { recursive: true })

  const defaultContent = {
    $schema: SCHEMA_URL,
    max_repos: DEFAULTS.max_repos,
    cache_loc: "~/.cache/gitloops/repos",
    eviction_strategy: DEFAULTS.eviction_strategy,
  }

  await fs.writeFile(
    CONFIG_PATH,
    JSON.stringify(defaultContent, null, 2) + "\n",
    "utf8"
  )

  return true
}

/**
 * Returns the config file path (for logging).
 */
export function getConfigPath(): string {
  return CONFIG_PATH
}
