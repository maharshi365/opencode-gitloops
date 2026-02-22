import type { Plugin } from "@opencode-ai/plugin"
import type { Config } from "@opencode-ai/sdk"
import pkg from "../package.json"
import { gitloops_clone, gitloops_refresh, gitloops_list } from "./tools"
import { ensureRepo } from "./repo-manager"
import { ensureConfigFile, getConfig } from "./config"
import { initLogger, logger } from "./logger"
import { buildGitloopsAgentDef } from "./agents"

export const GitLoopsPlugin: Plugin = async ({ client }) => {
  // Initialize the logger so all modules can use it
  initLogger(client)
  await logger.info(`Gitloops plugin v${pkg.version} initialized`, {
    version: pkg.version,
  })

  // Pre-load config so it's ready for the config hook
  let pluginConfig: Awaited<ReturnType<typeof getConfig>> | null = null
  try {
    await ensureConfigFile()
    pluginConfig = await getConfig()
    await logger.info("Gitloops config loaded", {
      cache_loc: pluginConfig.cache_loc,
    })
  } catch (err: any) {
    await logger.warn(`Failed to load config: ${err.message || err}`)
  }

  return {
    // Register the gitloops agent via the config hook.
    // This is called by OpenCode at startup to let plugins inject agents,
    // tools, and other config before the UI renders.
    config: async (config: Config) => {
      try {
        const cfg = pluginConfig ?? await getConfig()
        const agentDefs = (config.agent ?? {}) as Record<string, unknown>

        if (cfg.register_agent) {
          agentDefs.gitloops = buildGitloopsAgentDef(cfg)
          config.agent = agentDefs as Config["agent"]
          await logger.info("Gitloops agent registered via config hook")
        } else {
          await logger.info("Gitloops agent registration skipped (register_agent is false)")
        }
      } catch (err: any) {
        await logger.error(
          `Failed to register agent via config hook: ${err.message || err}`
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
