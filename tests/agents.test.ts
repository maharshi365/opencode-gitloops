import { describe, it, expect } from "bun:test"
import { buildAgentPrompt, buildGitloopsAgentDef } from "../src/agents"
import type { GitloopsConfig } from "../src/config"

const baseConfig: GitloopsConfig = {
  max_repos: 10,
  cache_loc: "/home/user/.cache/gitloops/repos",
  eviction_strategy: "lru",
  agent: {
    enabled: true,
    temperature: 0.1,
    color: "#ed5f00",
    mode: "all",
  },
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

  it("uses temperature from agent config", () => {
    const def = buildGitloopsAgentDef(baseConfig)
    expect(def.temperature).toBe(0.1)
  })

  it("uses custom temperature when provided", () => {
    const cfg = { ...baseConfig, agent: { ...baseConfig.agent, temperature: 0.5 } }
    const def = buildGitloopsAgentDef(cfg)
    expect(def.temperature).toBe(0.5)
  })

  it("uses color from agent config", () => {
    const def = buildGitloopsAgentDef(baseConfig)
    expect(def.color).toBe("#ed5f00")
  })

  it("uses custom color when provided", () => {
    const cfg = { ...baseConfig, agent: { ...baseConfig.agent, color: "#ff0000" } }
    const def = buildGitloopsAgentDef(cfg)
    expect(def.color).toBe("#ff0000")
  })

  it("uses mode from agent config", () => {
    const def = buildGitloopsAgentDef(baseConfig)
    expect(def.mode).toBe("all")
  })

  it("uses custom mode when provided", () => {
    const cfg = { ...baseConfig, agent: { ...baseConfig.agent, mode: "subagent" as const } }
    const def = buildGitloopsAgentDef(cfg)
    expect(def.mode).toBe("subagent")
  })

  it("does not set model when not provided", () => {
    const def = buildGitloopsAgentDef(baseConfig)
    expect(def.model).toBeUndefined()
  })

  it("sets model when provided in agent config", () => {
    const cfg = { ...baseConfig, agent: { ...baseConfig.agent, model: "anthropic/claude-sonnet-4-5" } }
    const def = buildGitloopsAgentDef(cfg)
    expect(def.model).toBe("anthropic/claude-sonnet-4-5")
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
