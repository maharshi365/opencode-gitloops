import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { logger } from "./logger"

const OPENCODE_JSON = path.join(".opencode", "opencode.json")
const SCHEMA_URL = "https://opencode.ai/config.json"

/**
 * Normalize an absolute path back to a ~-prefixed form if it falls under
 * the user's home directory.  This keeps the written pattern portable and
 * human-readable (e.g. "/Users/alice/.cache/gitloops/repos" -> "~/.cache/gitloops/repos").
 */
function toTildePath(absPath: string): string {
  const home = os.homedir()
  if (absPath === home) return "~"
  if (absPath.startsWith(home + path.sep)) {
    // Always write forward slashes in the pattern so it works cross-platform
    const rel = absPath.slice(home.length + 1).replace(/\\/g, "/")
    return `~/${rel}`
  }
  return absPath.replace(/\\/g, "/")
}

/**
 * On plugin startup, merge a `permission.external_directory` entry into the
 * project's opencode.json so that read/glob/list/grep can reach the gitloops
 * cache directory (which lives outside the project worktree).
 *
 * The operation is:
 *   - Additive  — never removes or overwrites existing keys
 *   - Idempotent — a no-op if the exact pattern already exists
 *   - Non-fatal  — failures are logged as warnings; startup continues
 *
 * @param worktreePath  The git worktree root where opencode.json lives (or
 *                      should be created).
 * @param cacheLoc      The resolved cache directory from the gitloops config
 *                      (default or user-supplied).  Used as-is — no path is
 *                      hardcoded here.
 */
export async function ensureOpencodeJsonPermissions(
  worktreePath: string,
  cacheLoc: string
): Promise<void> {
  const filePath = path.join(worktreePath, OPENCODE_JSON)

  // Build the wildcard pattern from whatever cache_loc is configured
  const tildeCache = toTildePath(cacheLoc)
  const pattern = `${tildeCache}/**`

  // Read existing file or start fresh
  let existing: Record<string, any> = { $schema: SCHEMA_URL }
  let fileExisted = false

  try {
    const raw = await fs.readFile(filePath, "utf8")
    existing = JSON.parse(raw)
    fileExisted = true
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      // File exists but is unparseable — log and bail; don't overwrite
      await logger.warn(
        "opencode.json exists but could not be parsed; skipping permission merge",
        { path: filePath, error: err?.message || String(err) }
      )
      return
    }
    // ENOENT — we will create the file below
  }

  // Navigate to permission.external_directory, creating missing levels
  const permission: Record<string, any> =
    existing.permission && typeof existing.permission === "object" && !Array.isArray(existing.permission)
      ? existing.permission
      : {}

  const externalDir: Record<string, any> =
    permission.external_directory && typeof permission.external_directory === "object" && !Array.isArray(permission.external_directory)
      ? permission.external_directory
      : {}

  // Idempotency check — nothing to do if the pattern is already there
  if (Object.prototype.hasOwnProperty.call(externalDir, pattern)) {
    await logger.debug(
      "opencode.json external_directory pattern already present; skipping",
      { pattern }
    )
    return
  }

  // Merge in the new pattern (last-match-wins, so append is fine)
  externalDir[pattern] = "allow"
  permission.external_directory = externalDir
  existing.permission = permission

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf8")

  await logger.info(
    fileExisted
      ? "Added gitloops cache dir to opencode.json external_directory permissions"
      : "Created opencode.json with gitloops cache dir external_directory permission",
    { path: filePath, pattern }
  )
}
