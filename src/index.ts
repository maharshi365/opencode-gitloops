import type { Plugin } from "@opencode-ai/plugin"
import { gitloops_clone, gitloops_refresh, gitloops_list } from "./tools"
import { ensureRepo } from "./repo-manager"
import { ensureConfigFile, getConfig, getConfigPath } from "./config"
import { initLogger, logger } from "./logger"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

function buildAgentMD(cacheLoc: string): string {
  return `---
description: Explore GitHub repositories locally. Clone any public repo and answer questions about its code, structure, and patterns.
mode: all
color: "#ed5f00"
temperature: 0.1
tools:
  read: true
  grep: true
  glob: true
  list: true
  webfetch: false
  bash: false
  edit: false
  write: false
  gitloops_clone: true
  gitloops_refresh: true
  gitloops_list: true
permission:
  edit: deny
  bash: deny
---

You are Gitloops, a read-only agent for exploring public GitHub repositories locally.

When a user asks about a repository:
1. Parse the repo slug from their message (e.g. "facebook/react" or a full GitHub URL)
2. Call \`gitloops_clone\` with the slug to clone or refresh the repo and get its local path
3. Use \`read\`, \`grep\`, \`glob\`, and \`list\` with absolute paths under the returned \`localPath\` to explore the code
4. Call \`gitloops_refresh\` if the user explicitly wants the latest changes
5. Call \`gitloops_list\` to show which repos are already cached locally

Important rules:
- You CANNOT modify any files. You are strictly read-only.
- Always call \`gitloops_clone\` first before trying to read any files from a repo.
- All file paths passed to read/grep/glob/list must be absolute paths under the repo's localPath.
- When switching between repos in the same session, always call \`gitloops_clone\` again for the new repo.

Repos are cached at: ${cacheLoc}/<owner>/<repo>/
`
}

export const GitLoopsPlugin: Plugin = async ({ client }) => {
  // Initialize the logger so all modules can use it
  initLogger(client)
  await logger.info("Gitloops plugin initialized")

  return {
    // Write agent definition and ensure config on server connect (idempotent)
    "server.connected": async () => {
      // Ensure the plugin config file exists (auto-create with defaults)
      try {
        const created = await ensureConfigFile()
        if (created) {
          await logger.info(`Config created with defaults at ${getConfigPath()}`)
        }
      } catch (err: any) {
        await logger.warn(`Failed to create config: ${err.message || err}`)
      }

      // Write agent definition to global config
      try {
        const config = await getConfig()
        const agentMD = buildAgentMD(config.cache_loc)

        const agentsDir = path.join(
          os.homedir(),
          ".config",
          "opencode",
          "agents"
        )
        const agentPath = path.join(agentsDir, "gitloops.md")

        await fs.mkdir(agentsDir, { recursive: true })

        const existing = await fs
          .readFile(agentPath, "utf8")
          .catch(() => null)

        if (existing !== agentMD) {
          await fs.writeFile(agentPath, agentMD, "utf8")
          await logger.info(`Agent definition written to ${agentPath}`)
        }
      } catch (err: any) {
        await logger.warn(
          `Failed to write agent definition: ${err.message || err}`
        )
      }
    },

    // Auto-fetch: when a gitloops session is created, pre-warm clone if a slug
    // is detectable from the session title
    event: async ({ event }: { event: { type: string; properties?: any } }) => {
      if (event.type !== "session.created") return

      try {
        const session = event.properties
        if (!session || session.agentID !== "gitloops") return

        // Try to find a slug in the session title
        const slugMatch = session.title?.match(
          /([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/
        )
        if (slugMatch) {
          await ensureRepo(slugMatch[1])
          await logger.info(`Pre-warmed repo: ${slugMatch[1]}`)
        }
      } catch {
        // Silent — agent will call gitloops_clone explicitly
      }
    },

    tool: {
      gitloops_clone,
      gitloops_refresh,
      gitloops_list,
    },
  }
}
