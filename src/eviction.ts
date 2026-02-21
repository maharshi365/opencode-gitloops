import * as fs from "fs/promises"
import * as path from "path"
import type { GitloopsConfig, EvictionStrategy } from "./config"
import { logger } from "./logger"

interface RepoStat {
  slug: string
  repoPath: string
  mtime: Date
  birthtime: Date
  size: number
}

/**
 * Recursively compute the total size (in bytes) of a directory.
 */
async function getDirSize(dirPath: string): Promise<number> {
  let total = 0
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      total += await getDirSize(fullPath)
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath)
      total += stat.size
    }
  }
  return total
}

/**
 * Gather stats for all cached repos under the cache location.
 */
async function gatherRepoStats(cacheLoc: string): Promise<RepoStat[]> {
  const stats: RepoStat[] = []

  let owners: string[]
  try {
    owners = await fs.readdir(cacheLoc)
  } catch {
    return stats
  }

  for (const owner of owners) {
    const ownerPath = path.join(cacheLoc, owner)
    let ownerStat
    try {
      ownerStat = await fs.stat(ownerPath)
    } catch {
      continue
    }
    if (!ownerStat.isDirectory()) continue

    let repoNames: string[]
    try {
      repoNames = await fs.readdir(ownerPath)
    } catch {
      continue
    }

    for (const repo of repoNames) {
      const repoPath = path.join(ownerPath, repo)
      try {
        const gitDir = path.join(repoPath, ".git")
        const gitStat = await fs.stat(gitDir)
        if (!gitStat.isDirectory()) continue
      } catch {
        continue // not a git repo
      }

      try {
        const stat = await fs.stat(repoPath)
        stats.push({
          slug: `${owner}/${repo}`,
          repoPath,
          mtime: stat.mtime,
          birthtime: stat.birthtime,
          size: 0, // computed lazily for "largest" strategy
        })
      } catch {
        continue
      }
    }
  }

  return stats
}

/**
 * Remove a cached repo directory and clean up empty parent owner directories.
 */
async function removeRepo(repoPath: string, cacheLoc: string): Promise<void> {
  await fs.rm(repoPath, { recursive: true, force: true })

  // Clean up empty owner directory
  const ownerDir = path.dirname(repoPath)
  try {
    const remaining = await fs.readdir(ownerDir)
    if (remaining.length === 0) {
      await fs.rmdir(ownerDir)
    }
  } catch {
    // Ignore — owner dir may already be gone
  }
}

/**
 * Sort repos by eviction priority (first element = first to evict).
 */
async function sortByStrategy(
  repos: RepoStat[],
  strategy: EvictionStrategy
): Promise<RepoStat[]> {
  const sorted = [...repos]

  switch (strategy) {
    case "lru":
      // Least recently modified first
      sorted.sort((a, b) => a.mtime.getTime() - b.mtime.getTime())
      break

    case "fifo":
      // Oldest creation time first
      sorted.sort((a, b) => a.birthtime.getTime() - b.birthtime.getTime())
      break

    case "largest":
      // Compute sizes then sort largest first
      for (const repo of sorted) {
        repo.size = await getDirSize(repo.repoPath)
      }
      sorted.sort((a, b) => b.size - a.size)
      break
  }

  return sorted
}

/**
 * Evict repos if the total count exceeds max_repos.
 * Removes repos according to the configured eviction strategy until
 * the count is within the limit.
 *
 * @param config - The current gitloops config
 * @param currentSlug - Optional slug to protect from eviction (e.g. the repo just cloned)
 * @returns Array of evicted repo slugs
 */
export async function evictIfNeeded(
  config: GitloopsConfig,
  currentSlug?: string
): Promise<string[]> {
  const allRepos = await gatherRepoStats(config.cache_loc)

  if (allRepos.length <= config.max_repos) {
    await logger.debug("Eviction check passed", {
      cached: allRepos.length,
      max: config.max_repos,
    })
    return []
  }

  const evictCount = allRepos.length - config.max_repos

  await logger.info(
    `Eviction triggered: ${allRepos.length} cached repos exceeds limit of ${config.max_repos}`,
    { strategy: config.eviction_strategy, evictCount }
  )

  const sorted = await sortByStrategy(allRepos, config.eviction_strategy)

  // Filter out the current repo from eviction candidates
  const candidates = currentSlug
    ? sorted.filter((r) => r.slug !== currentSlug)
    : sorted

  const evicted: string[] = []
  for (let i = 0; i < evictCount && i < candidates.length; i++) {
    const repo = candidates[i]
    try {
      await removeRepo(repo.repoPath, config.cache_loc)
      evicted.push(repo.slug)
      await logger.info(`Evicted repo: ${repo.slug}`, {
        strategy: config.eviction_strategy,
        path: repo.repoPath,
      })
    } catch (err: any) {
      await logger.warn(`Failed to evict repo: ${repo.slug}`, {
        path: repo.repoPath,
        error: err?.message || String(err),
      })
    }
  }

  await logger.info(`Eviction complete: removed ${evicted.length} repo(s)`, {
    evicted,
    remaining: allRepos.length - evicted.length,
  })

  return evicted
}
