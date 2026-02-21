import { tool } from "@opencode-ai/plugin"
import { ensureRepo, listCachedRepos } from "./repo-manager"

export const gitloops_clone = tool({
  description:
    "Clone or ensure a GitHub repo is available locally for exploration. " +
    "Returns the local filesystem path to use with read/grep/glob/list tools. " +
    "Accepts 'owner/repo' shorthand or a full GitHub URL.",
  args: {
    repo: tool.schema
      .string()
      .describe(
        "Repo identifier — e.g. 'facebook/react' or 'https://github.com/facebook/react'"
      ),
    branch: tool.schema
      .string()
      .optional()
      .describe("Branch to checkout after cloning (default: repo default branch)"),
  },
  async execute(args) {
    const info = await ensureRepo(args.repo)

    // If a specific branch was requested, check it out
    if (args.branch) {
      const { $ } = await import("bun")
      try {
        await $`git -C ${info.localPath} fetch origin ${args.branch}`.quiet()
        await $`git -C ${info.localPath} checkout ${args.branch}`.quiet()
        await $`git -C ${info.localPath} reset --hard origin/${args.branch}`.quiet()
      } catch (err: any) {
        throw new Error(
          `Failed to checkout branch "${args.branch}" for ${info.slug}: ${err.message || err}`
        )
      }
    }

    return [
      `Repository: ${info.slug}`,
      `Local path: ${info.localPath}`,
      `Last commit: ${info.lastCommit}`,
      `Last fetched: ${info.lastFetched}`,
      ``,
      `Use this path with read, grep, glob, and list tools to explore the repo.`,
    ].join("\n")
  },
})

export const gitloops_refresh = tool({
  description:
    "Force-fetch the latest changes for a previously cloned GitHub repo. " +
    "Use this when the user wants the most up-to-date code.",
  args: {
    repo: tool.schema
      .string()
      .describe("Repo identifier — e.g. 'facebook/react'"),
  },
  async execute(args) {
    const info = await ensureRepo(args.repo)

    return [
      `Refreshed: ${info.slug}`,
      `Local path: ${info.localPath}`,
      `Last commit: ${info.lastCommit}`,
      `Fetched at: ${info.lastFetched}`,
    ].join("\n")
  },
})

export const gitloops_list = tool({
  description:
    "List all GitHub repos currently cached locally by gitloops. " +
    "Shows slug, local path, and last modified time for each cached repo.",
  args: {},
  async execute() {
    const repos = await listCachedRepos()

    if (repos.length === 0) {
      return "No repos cached. Use gitloops_clone to clone a repo first."
    }

    const lines = repos.map(
      (r) => `${r.slug}  ${r.localPath}  (modified: ${r.lastModified})`
    )
    return [`Cached repos (${repos.length}):`, "", ...lines].join("\n")
  },
})
