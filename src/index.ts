import type { Plugin } from "@opencode-ai/plugin"
import { gitloops_clone, gitloops_refresh, gitloops_list } from "./tools"
import { ensureRepo } from "./repo-manager"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

const AGENT_MD = `---
description: Explore GitHub repositories locally. Clone any public repo and answer questions about its code, structure, and patterns.
mode: all
color: "#4078c0"
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

You are GitLoops, a read-only agent for exploring public GitHub repositories locally.

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

Repos are cached at: ~/.cache/gitloops/repos/<owner>/<repo>/
`

export const GitLoopsPlugin: Plugin = async ({ client }) => {
  return {
    // Write agent definition to global config on server connect (idempotent)
    "server.connected": async () => {
      try {
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

        if (existing !== AGENT_MD) {
          await fs.writeFile(agentPath, AGENT_MD, "utf8")
          await client.app.log({
            body: {
              service: "opencode-gitloops",
              level: "info",
              message: `Agent definition written to ${agentPath}`,
            },
          })
        }
      } catch (err: any) {
        await client.app.log({
          body: {
            service: "opencode-gitloops",
            level: "warn",
            message: `Failed to write agent definition: ${err.message || err}`,
          },
        })
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
          await client.app.log({
            body: {
              service: "opencode-gitloops",
              level: "info",
              message: `Pre-warmed repo: ${slugMatch[1]}`,
            },
          })
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
