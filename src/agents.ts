import type { GitloopsConfig } from "./config"

/**
 * Build the system prompt for the gitloops agent.
 */
export function buildAgentPrompt(cacheLoc: string): string {
  return `You are Gitloops, a read-only agent for exploring GitHub repositories locally.

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
- Private repositories are supported as long as your local git credentials or SSH keys have access.

Repos are cached at: ${cacheLoc}/<owner>/<repo>/`
}

/**
 * Build the full agent definition object for the gitloops agent.
 */
export function buildGitloopsAgentDef(cfg: GitloopsConfig): Record<string, unknown> {
  return {
    description:
      "Explore GitHub repositories locally. Clone any public repo and answer questions about its code, structure, and patterns.",
    mode: "all" as const,
    color: "#ed5f00",
    temperature: 0.1,
    tools: {
      read: true,
      grep: true,
      glob: true,
      list: true,
      webfetch: false,
      bash: false,
      edit: false,
      write: false,
      gitloops_clone: true,
      gitloops_refresh: true,
      gitloops_list: true,
    },
    permission: {
      edit: "deny" as const,
      bash: "deny" as const,
    },
    prompt: buildAgentPrompt(cfg.cache_loc),
  }
}
