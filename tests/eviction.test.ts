import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { setTimeout as sleep } from "timers/promises"
import { evictIfNeeded } from "../src/eviction"
import type { GitloopsConfig } from "../src/config"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fake cached repo directory tree:
 *   <cacheDir>/<owner>/<repo>/.git/
 *
 * Optionally touch files inside to influence mtime / size.
 */
async function makeRepo(
  cacheDir: string,
  slug: string,
  options: { mtime?: Date; birthtime?: Date; fileSizeBytes?: number } = {}
): Promise<string> {
  const [owner, repo] = slug.split("/")
  const repoPath = path.join(cacheDir, owner, repo)
  const gitDir = path.join(repoPath, ".git")
  await fs.mkdir(gitDir, { recursive: true })

  if (options.fileSizeBytes !== undefined && options.fileSizeBytes > 0) {
    // Write a file of the requested size inside the repo so getDirSize works
    const buf = Buffer.alloc(options.fileSizeBytes, "x")
    await fs.writeFile(path.join(repoPath, "bigfile"), buf)
  }

  // Adjust mtime/atime if requested (birthtime is read-only on most OSes, so
  // we rely on insertion order for FIFO tests instead)
  if (options.mtime) {
    await fs.utimes(repoPath, options.mtime, options.mtime)
  }

  return repoPath
}

/** Resolves true if the path exists, false if not. */
const canAccess = (p: string) => fs.access(p).then(() => true, () => false)

function makeConfig(
  cacheDir: string,
  maxRepos: number,
  strategy: GitloopsConfig["eviction_strategy"]
): GitloopsConfig {
  return { cache_loc: cacheDir, max_repos: maxRepos, eviction_strategy: strategy }
}

// ---------------------------------------------------------------------------
// Fixture management
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitloops-eviction-test-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// No-op: under / at the limit
// ---------------------------------------------------------------------------

describe("evictIfNeeded – no eviction needed", () => {
  it("returns [] when cache is empty", async () => {
    const config = makeConfig(tmpDir, 5, "lru")
    const evicted = await evictIfNeeded(config)
    expect(evicted).toEqual([])
  })

  it("returns [] when repo count equals max_repos", async () => {
    await makeRepo(tmpDir, "owner/a")
    await makeRepo(tmpDir, "owner/b")
    const config = makeConfig(tmpDir, 2, "lru")
    const evicted = await evictIfNeeded(config)
    expect(evicted).toEqual([])
  })

  it("returns [] when repo count is below max_repos", async () => {
    await makeRepo(tmpDir, "owner/a")
    const config = makeConfig(tmpDir, 5, "fifo")
    const evicted = await evictIfNeeded(config)
    expect(evicted).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// LRU strategy
// ---------------------------------------------------------------------------

describe("evictIfNeeded – LRU strategy", () => {
  it("evicts the least-recently-used repo when over the limit", async () => {
    const now = Date.now()
    // oldest → newest in terms of mtime
    await makeRepo(tmpDir, "owner/old", { mtime: new Date(now - 3000) })
    await makeRepo(tmpDir, "owner/mid", { mtime: new Date(now - 2000) })
    await makeRepo(tmpDir, "owner/new", { mtime: new Date(now - 1000) })

    const config = makeConfig(tmpDir, 2, "lru")
    const evicted = await evictIfNeeded(config)

    expect(evicted).toEqual(["owner/old"])
  })

  it("evicts multiple repos to satisfy max_repos", async () => {
    const now = Date.now()
    await makeRepo(tmpDir, "owner/a", { mtime: new Date(now - 4000) })
    await makeRepo(tmpDir, "owner/b", { mtime: new Date(now - 3000) })
    await makeRepo(tmpDir, "owner/c", { mtime: new Date(now - 2000) })
    await makeRepo(tmpDir, "owner/d", { mtime: new Date(now - 1000) })

    const config = makeConfig(tmpDir, 2, "lru")
    const evicted = await evictIfNeeded(config)

    expect(evicted).toHaveLength(2)
    expect(evicted).toContain("owner/a")
    expect(evicted).toContain("owner/b")
  })

  it("actually removes the evicted repo directories from disk", async () => {
    const now = Date.now()
    const oldPath = await makeRepo(tmpDir, "owner/old", {
      mtime: new Date(now - 3000),
    })
    await makeRepo(tmpDir, "owner/new", { mtime: new Date(now - 1000) })

    const config = makeConfig(tmpDir, 1, "lru")
    await evictIfNeeded(config)

    await expect(fs.access(oldPath)).rejects.toThrow()
  })

  it("leaves non-evicted repos intact on disk", async () => {
    const now = Date.now()
    await makeRepo(tmpDir, "owner/old", { mtime: new Date(now - 3000) })
    const newPath = await makeRepo(tmpDir, "owner/new", {
      mtime: new Date(now - 1000),
    })

    const config = makeConfig(tmpDir, 1, "lru")
    await evictIfNeeded(config)

    expect(await canAccess(newPath)).toBe(true)
  })

  it("protects currentSlug from eviction", async () => {
    const now = Date.now()
    // "owner/protected" is the oldest but should be protected
    await makeRepo(tmpDir, "owner/protected", { mtime: new Date(now - 9000) })
    await makeRepo(tmpDir, "owner/b", { mtime: new Date(now - 2000) })
    await makeRepo(tmpDir, "owner/c", { mtime: new Date(now - 1000) })

    const config = makeConfig(tmpDir, 2, "lru")
    const evicted = await evictIfNeeded(config, "owner/protected")

    expect(evicted).not.toContain("owner/protected")
    // The next-oldest candidate (b) should be evicted instead
    expect(evicted).toContain("owner/b")
  })
})

// ---------------------------------------------------------------------------
// FIFO strategy
// ---------------------------------------------------------------------------

describe("evictIfNeeded – FIFO strategy", () => {
  it("evicts based on birthtime (oldest first) when over the limit", async () => {
    // We can't reliably set birthtime, so we rely on fs.stat birthtime
    // reflecting actual creation order by sleeping briefly between creates.
    const now = Date.now()
    await makeRepo(tmpDir, "org/first", { mtime: new Date(now - 3000) })
    await sleep(20)
    await makeRepo(tmpDir, "org/second", { mtime: new Date(now - 2000) })
    await sleep(20)
    await makeRepo(tmpDir, "org/third", { mtime: new Date(now - 1000) })

    const config = makeConfig(tmpDir, 2, "fifo")
    const evicted = await evictIfNeeded(config)

    // The first-created repo should be evicted
    expect(evicted).toHaveLength(1)
    expect(evicted[0]).toBe("org/first")
  })

  it("protects currentSlug from eviction (FIFO)", async () => {
    const now = Date.now()
    await makeRepo(tmpDir, "org/first", { mtime: new Date(now - 3000) })
    await sleep(20)
    await makeRepo(tmpDir, "org/second", { mtime: new Date(now - 2000) })
    await sleep(20)
    await makeRepo(tmpDir, "org/third", { mtime: new Date(now - 1000) })

    const config = makeConfig(tmpDir, 2, "fifo")
    const evicted = await evictIfNeeded(config, "org/first")

    expect(evicted).not.toContain("org/first")
    expect(evicted).toContain("org/second")
  })
})

// ---------------------------------------------------------------------------
// Largest strategy
// ---------------------------------------------------------------------------

describe("evictIfNeeded – largest strategy", () => {
  it("evicts the largest repo when over the limit", async () => {
    await makeRepo(tmpDir, "org/small", { fileSizeBytes: 100 })
    await makeRepo(tmpDir, "org/medium", { fileSizeBytes: 500 })
    await makeRepo(tmpDir, "org/large", { fileSizeBytes: 1000 })

    const config = makeConfig(tmpDir, 2, "largest")
    const evicted = await evictIfNeeded(config)

    expect(evicted).toEqual(["org/large"])
  })

  it("evicts the two largest repos when two need to be removed", async () => {
    await makeRepo(tmpDir, "org/tiny", { fileSizeBytes: 50 })
    await makeRepo(tmpDir, "org/small", { fileSizeBytes: 100 })
    await makeRepo(tmpDir, "org/medium", { fileSizeBytes: 500 })
    await makeRepo(tmpDir, "org/large", { fileSizeBytes: 1000 })

    const config = makeConfig(tmpDir, 2, "largest")
    const evicted = await evictIfNeeded(config)

    expect(evicted).toHaveLength(2)
    expect(evicted).toContain("org/large")
    expect(evicted).toContain("org/medium")
  })

  it("protects currentSlug from eviction (largest)", async () => {
    await makeRepo(tmpDir, "org/small", { fileSizeBytes: 100 })
    await makeRepo(tmpDir, "org/medium", { fileSizeBytes: 500 })
    await makeRepo(tmpDir, "org/large", { fileSizeBytes: 1000 })

    const config = makeConfig(tmpDir, 2, "largest")
    const evicted = await evictIfNeeded(config, "org/large")

    expect(evicted).not.toContain("org/large")
    expect(evicted).toContain("org/medium")
  })
})

// ---------------------------------------------------------------------------
// Owner-directory cleanup
// ---------------------------------------------------------------------------

describe("evictIfNeeded – owner directory cleanup", () => {
  it("removes the owner directory when its last repo is evicted", async () => {
    const now = Date.now()
    await makeRepo(tmpDir, "solo-owner/only-repo", {
      mtime: new Date(now - 5000),
    })
    await makeRepo(tmpDir, "other-owner/repo", { mtime: new Date(now - 1000) })

    const config = makeConfig(tmpDir, 1, "lru")
    const evicted = await evictIfNeeded(config)

    expect(evicted).toContain("solo-owner/only-repo")

    // The parent owner dir should be gone too
    const ownerDir = path.join(tmpDir, "solo-owner")
    await expect(fs.access(ownerDir)).rejects.toThrow()
  })

  it("keeps the owner directory when it still has other repos", async () => {
    const now = Date.now()
    await makeRepo(tmpDir, "shared-owner/old-repo", {
      mtime: new Date(now - 5000),
    })
    await makeRepo(tmpDir, "shared-owner/new-repo", {
      mtime: new Date(now - 1000),
    })

    const config = makeConfig(tmpDir, 1, "lru")
    const evicted = await evictIfNeeded(config)

    expect(evicted).toContain("shared-owner/old-repo")

    const ownerDir = path.join(tmpDir, "shared-owner")
    expect(await canAccess(ownerDir)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("evictIfNeeded – edge cases", () => {
  it("handles a non-existent cache directory gracefully", async () => {
    const missingDir = path.join(tmpDir, "does-not-exist")
    const config = makeConfig(missingDir, 5, "lru")
    const evicted = await evictIfNeeded(config)
    expect(evicted).toEqual([])
  })

  it("ignores non-directory entries in the owner directory", async () => {
    // Place a loose file directly under cacheDir (not an owner dir)
    await fs.writeFile(path.join(tmpDir, "stray-file.txt"), "oops")
    await makeRepo(tmpDir, "owner/repo")

    const config = makeConfig(tmpDir, 5, "lru")
    const evicted = await evictIfNeeded(config)
    expect(evicted).toEqual([])
  })

  it("ignores directories inside an owner dir that lack a .git folder", async () => {
    // Create a directory that looks like a repo but has no .git
    const fakePath = path.join(tmpDir, "owner", "not-a-repo")
    await fs.mkdir(fakePath, { recursive: true })

    const config = makeConfig(tmpDir, 0, "lru") // max_repos=0 forces eviction
    const evicted = await evictIfNeeded(config)
    // The fake dir should not be listed, so nothing to evict
    expect(evicted).toEqual([])
  })

  it("max_repos=0 evicts all repos", async () => {
    await makeRepo(tmpDir, "owner/a")
    await makeRepo(tmpDir, "owner/b")

    const config = makeConfig(tmpDir, 0, "lru")
    const evicted = await evictIfNeeded(config)

    expect(evicted).toHaveLength(2)
    expect(evicted).toContain("owner/a")
    expect(evicted).toContain("owner/b")
  })

  it("returns [] when currentSlug is the only repo over the limit", async () => {
    // Only one repo cached, but max is 0. Since it's protected, nothing should
    // actually be evicted (no other candidates).
    await makeRepo(tmpDir, "owner/protected")
    const config = makeConfig(tmpDir, 0, "lru")
    const evicted = await evictIfNeeded(config, "owner/protected")
    expect(evicted).toEqual([])
  })
})
