import { describe, it, expect } from "bun:test"
import { buildAgentPrompt, buildGitloopsAgentDef } from "../src/agents"
import type { GitloopsConfig } from "../src/config"

const baseConfig: GitloopsConfig = {
  max_repos: 10,
  cache_loc: "/home/user/.cache/gitloops/repos",
  eviction_strategy: "lru",
  register_agent: true,
}

describe("buildAgentPrompt", () => {
  it("includes the cache location in the prompt", () => {
    const prompt = buildAgentPrompt("/custom/cache/path")
    expect(prompt).toContain("/custom/cache/path")
  })

  it("mentions gitloops_clone, gitloops_refresh, gitloops_list tools", () => {
    const prompt = buildAgentPrompt("/cache")
    expect(prompt).toContain("gitloops_clone")
    expect(prompt).toContain("gitloops_refresh")
    expect(prompt).toContain("gitloops_list")
  })

  it("states the agent is read-only", () => {
    const prompt = buildAgentPrompt("/cache")
    expect(prompt).toContain("read-only")
  })

  it("mentions private repository support", () => {
    const prompt = buildAgentPrompt("/cache")
    expect(prompt).toContain("Private repositories")
  })
})

describe("buildGitloopsAgentDef", () => {
  it("returns an object with a description", () => {
    const def = buildGitloopsAgentDef(baseConfig)
    expect(typeof def.description).toBe("string")
    expect((def.description as string).length).toBeGreaterThan(0)
  })

  it("embeds the cache_loc from config into the prompt", () => {
    const cfg = { ...baseConfig, cache_loc: "/my/special/cache" }
    const def = buildGitloopsAgentDef(cfg)
    expect(def.prompt as string).toContain("/my/special/cache")
  })

  it("has the correct temperature", () => {
    const def = buildGitloopsAgentDef(baseConfig)
    expect(def.temperature).toBe(0.1)
  })

  it("enables read/grep/glob/list tools", () => {
    const def = buildGitloopsAgentDef(baseConfig)
    const tools = def.tools as Record<string, boolean>
    expect(tools.read).toBe(true)
    expect(tools.grep).toBe(true)
    expect(tools.glob).toBe(true)
    expect(tools.list).toBe(true)
  })

  it("disables bash, edit, write, webfetch tools", () => {
    const def = buildGitloopsAgentDef(baseConfig)
    const tools = def.tools as Record<string, boolean>
    expect(tools.bash).toBe(false)
    expect(tools.edit).toBe(false)
    expect(tools.write).toBe(false)
    expect(tools.webfetch).toBe(false)
  })

  it("enables gitloops_clone, gitloops_refresh, gitloops_list tools", () => {
    const def = buildGitloopsAgentDef(baseConfig)
    const tools = def.tools as Record<string, boolean>
    expect(tools.gitloops_clone).toBe(true)
    expect(tools.gitloops_refresh).toBe(true)
    expect(tools.gitloops_list).toBe(true)
  })

  it("sets edit and bash permissions to deny", () => {
    const def = buildGitloopsAgentDef(baseConfig)
    const permission = def.permission as Record<string, string>
    expect(permission.edit).toBe("deny")
    expect(permission.bash).toBe("deny")
  })

  it("returns a new object on each call (no shared references)", () => {
    const def1 = buildGitloopsAgentDef(baseConfig)
    const def2 = buildGitloopsAgentDef(baseConfig)
    expect(def1).not.toBe(def2)
    expect(def1.tools).not.toBe(def2.tools)
  })
})
