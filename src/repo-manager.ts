import { $ } from "bun"
import * as fs from "fs/promises"
import * as path from "path"
import { getConfig } from "./config"
import { evictIfNeeded } from "./eviction"
import { extractGitError } from "./git-error"
import { logger } from "./logger"

export interface RepoInfo {
  localPath: string
  slug: string
  owner: string
  repo: string
  lastCommit: string
  lastFetched: string
}

export interface CachedRepo {
  slug: string
  localPath: string
  lastModified: string
}

export interface ParsedRepo {
  owner: string
  repo: string
  cloneUrl: string
  slug: string
}

/**
 * Parse a repo slug or URL into its components.
 *
 * Accepts:
 *   - "facebook/react"
 *   - "https://github.com/facebook/react"
 *   - "https://github.com/facebook/react.git"
 *   - "git@github.com:facebook/react.git"
 */
export function parseRepoSlug(input: string): ParsedRepo {
  const trimmed = input.trim()

  // Handle full HTTPS URLs
  const httpsMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/
  )
  if (httpsMatch) {
    const [, owner, repo] = httpsMatch
    return {
      owner,
      repo,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
      slug: `${owner}/${repo}`,
    }
  }

  // Handle SSH URLs
  const sshMatch = trimmed.match(
    /^git@github\.com:([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/
  )
  if (sshMatch) {
    const [, owner, repo] = sshMatch
    return {
      owner,
      repo,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
      slug: `${owner}/${repo}`,
    }
  }

  // Handle owner/repo shorthand
  const slugMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/)
  if (slugMatch) {
    const [, owner, repo] = slugMatch
    return {
      owner,
      repo,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
      slug: `${owner}/${repo}`,
    }
  }

  throw new Error(
    `Invalid repo identifier: "${input}". Expected "owner/repo", a GitHub HTTPS URL, or an SSH URL.`
  )
}

/**
 * Get the local filesystem path where a repo is (or would be) cached.
 */
export async function getLocalPath(slug: string): Promise<string> {
  const { owner, repo } = parseRepoSlug(slug)
  const config = await getConfig()
  return path.join(config.cache_loc, owner, repo)
}

/**
 * Check if a directory exists.
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * Get the latest commit hash from a local repo.
 */
async function getLastCommit(repoPath: string): Promise<string> {
  try {
    const result = await $`git -C ${repoPath} rev-parse --short HEAD`.text()
    return result.trim()
  } catch {
    return "unknown"
  }
}

/**
 * Clone a repo (or fetch latest if already cloned). Returns metadata about the repo.
 *
 * Respects GITLOOPS_FULL_CLONE env var — if truthy, clones without --depth=1.
 * Enforces max_repos limit via the configured eviction strategy after cloning.
 */
export async function ensureRepo(input: string): Promise<RepoInfo> {
  const parsed = parseRepoSlug(input)

  await logger.debug(`Parsed repo identifier: ${parsed.slug}`, {
    input,
    owner: parsed.owner,
    repo: parsed.repo,
  })

  const config = await getConfig()
  const localPath = path.join(config.cache_loc, parsed.owner, parsed.repo)
  const fullClone = process.env.GITLOOPS_FULL_CLONE === "true"
  const depthArgs = fullClone ? [] : ["--depth=1"]

  if (await dirExists(path.join(localPath, ".git"))) {
    // Repo already cloned — fetch latest
    await logger.info(`Fetching updates for ${parsed.slug}`, {
      path: localPath,
      fullClone,
    })
    try {
      if (fullClone) {
        await $`git -C ${localPath} fetch origin`.quiet()
      } else {
        await $`git -C ${localPath} fetch --depth=1 origin`.quiet()
      }
      await $`git -C ${localPath} reset --hard origin/HEAD`.quiet()
      await logger.info(`Updated repo: ${parsed.slug}`)
    } catch (err: any) {
      const { stderr, detail } = extractGitError(err)
      await logger.error(`Failed to fetch updates for ${parsed.slug}`, {
        error: detail,
        stderr,
      })
      throw new Error(
        `Failed to fetch updates for ${parsed.slug}: ${detail}`
      )
    }
  } else {
    // Fresh clone
    await logger.info(`Cloning ${parsed.slug}`, {
      url: parsed.cloneUrl,
      path: localPath,
      fullClone,
    })
    const startTime = Date.now()
    await fs.mkdir(path.dirname(localPath), { recursive: true })
    try {
      await $`git clone ${depthArgs} ${parsed.cloneUrl} ${localPath}`.quiet()
      const duration = Date.now() - startTime
      await logger.info(`Cloned repo: ${parsed.slug} (${duration}ms)`, {
        path: localPath,
        durationMs: duration,
      })
    } catch (err: any) {
      // Clean up partial clone on failure
      await fs.rm(localPath, { recursive: true, force: true }).catch(() => {})

      // Extract stderr from Bun ShellError for meaningful diagnostics
      const { stderr, detail } = extractGitError(err)

      if (
        detail.includes("not found") ||
        detail.includes("Repository not found")
      ) {
        await logger.error(`Repository not found: ${parsed.slug}`, {
          url: parsed.cloneUrl,
          stderr,
        })
        throw new Error(
          `Repository "${parsed.slug}" not found on GitHub. Only public repos are supported in v1.`
        )
      }
      await logger.error(`Failed to clone ${parsed.slug}`, {
        error: detail,
        stderr,
      })
      throw new Error(
        `Failed to clone ${parsed.slug}: ${detail}`
      )
    }

    // Evict old repos if we've exceeded the max
    await evictIfNeeded(config, parsed.slug)
  }

  const lastCommit = await getLastCommit(localPath)

  return {
    localPath,
    slug: parsed.slug,
    owner: parsed.owner,
    repo: parsed.repo,
    lastCommit,
    lastFetched: new Date().toISOString(),
  }
}

/**
 * List all repos currently cached under the configured cache location.
 */
export async function listCachedRepos(): Promise<CachedRepo[]> {
  const config = await getConfig()
  const cacheLoc = config.cache_loc
  const repos: CachedRepo[] = []

  if (!(await dirExists(cacheLoc))) {
    return repos
  }

  let owners: string[]
  try {
    owners = await fs.readdir(cacheLoc)
  } catch {
    return repos
  }

  for (const owner of owners) {
    const ownerPath = path.join(cacheLoc, owner)
    if (!(await dirExists(ownerPath))) continue

    let repoNames: string[]
    try {
      repoNames = await fs.readdir(ownerPath)
    } catch {
      continue
    }

    for (const repo of repoNames) {
      const repoPath = path.join(ownerPath, repo)
      if (!(await dirExists(path.join(repoPath, ".git")))) continue

      let lastModified: string
      try {
        const stat = await fs.stat(repoPath)
        lastModified = stat.mtime.toISOString()
      } catch {
        lastModified = "unknown"
      }

      repos.push({
        slug: `${owner}/${repo}`,
        localPath: repoPath,
        lastModified,
      })
    }
  }

  return repos
}
