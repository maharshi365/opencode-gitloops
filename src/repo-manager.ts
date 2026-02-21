import { $ } from "bun"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

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

const CACHE_ROOT = path.join(os.homedir(), ".cache", "gitloops", "repos")

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
export function getLocalPath(slug: string): string {
  const { owner, repo } = parseRepoSlug(slug)
  return path.join(CACHE_ROOT, owner, repo)
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
 */
export async function ensureRepo(input: string): Promise<RepoInfo> {
  const parsed = parseRepoSlug(input)
  const localPath = path.join(CACHE_ROOT, parsed.owner, parsed.repo)
  const fullClone = process.env.GITLOOPS_FULL_CLONE === "true"
  const depthArgs = fullClone ? [] : ["--depth=1"]

  if (await dirExists(path.join(localPath, ".git"))) {
    // Repo already cloned — fetch latest
    try {
      if (fullClone) {
        await $`git -C ${localPath} fetch origin`.quiet()
      } else {
        await $`git -C ${localPath} fetch --depth=1 origin`.quiet()
      }
      await $`git -C ${localPath} reset --hard origin/HEAD`.quiet()
    } catch (err: any) {
      throw new Error(
        `Failed to fetch updates for ${parsed.slug}: ${err.message || err}`
      )
    }
  } else {
    // Fresh clone
    await fs.mkdir(path.dirname(localPath), { recursive: true })
    try {
      await $`git clone ${depthArgs} ${parsed.cloneUrl} ${localPath}`.quiet()
    } catch (err: any) {
      // Clean up partial clone on failure
      await fs.rm(localPath, { recursive: true, force: true }).catch(() => {})
      if (
        String(err).includes("not found") ||
        String(err).includes("Repository not found")
      ) {
        throw new Error(
          `Repository "${parsed.slug}" not found on GitHub. Only public repos are supported in v1.`
        )
      }
      throw new Error(
        `Failed to clone ${parsed.slug}: ${err.message || err}`
      )
    }
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
 * List all repos currently cached under ~/.cache/gitloops/repos/.
 */
export async function listCachedRepos(): Promise<CachedRepo[]> {
  const repos: CachedRepo[] = []

  if (!(await dirExists(CACHE_ROOT))) {
    return repos
  }

  let owners: string[]
  try {
    owners = await fs.readdir(CACHE_ROOT)
  } catch {
    return repos
  }

  for (const owner of owners) {
    const ownerPath = path.join(CACHE_ROOT, owner)
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
