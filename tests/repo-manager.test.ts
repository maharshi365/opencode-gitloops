import { describe, it, expect } from "bun:test"
import { parseRepoSlug } from "../src/repo-manager"

describe("parseRepoSlug", () => {
  it("parses owner/repo shorthand", () => {
    const result = parseRepoSlug("facebook/react")
    expect(result.owner).toBe("facebook")
    expect(result.repo).toBe("react")
    expect(result.slug).toBe("facebook/react")
    expect(result.cloneUrl).toBe("https://github.com/facebook/react.git")
  })

  it("parses HTTPS URL", () => {
    const result = parseRepoSlug("https://github.com/facebook/react")
    expect(result.owner).toBe("facebook")
    expect(result.repo).toBe("react")
    expect(result.slug).toBe("facebook/react")
    expect(result.cloneUrl).toBe("https://github.com/facebook/react.git")
  })

  it("parses HTTPS URL with .git suffix", () => {
    const result = parseRepoSlug("https://github.com/facebook/react.git")
    expect(result.owner).toBe("facebook")
    expect(result.repo).toBe("react")
    expect(result.slug).toBe("facebook/react")
  })

  it("parses SSH URL", () => {
    const result = parseRepoSlug("git@github.com:facebook/react.git")
    expect(result.owner).toBe("facebook")
    expect(result.repo).toBe("react")
    expect(result.slug).toBe("facebook/react")
    expect(result.cloneUrl).toBe("https://github.com/facebook/react.git")
  })

  it("parses SSH URL without .git suffix", () => {
    const result = parseRepoSlug("git@github.com:facebook/react")
    expect(result.owner).toBe("facebook")
    expect(result.repo).toBe("react")
  })

  it("trims whitespace from input", () => {
    const result = parseRepoSlug("  facebook/react  ")
    expect(result.owner).toBe("facebook")
    expect(result.repo).toBe("react")
  })

  it("handles owner/repo with dots", () => {
    const result = parseRepoSlug("some.org/my.repo")
    expect(result.owner).toBe("some.org")
    expect(result.repo).toBe("my.repo")
  })

  it("handles owner/repo with hyphens and underscores", () => {
    const result = parseRepoSlug("my-org/my_repo")
    expect(result.owner).toBe("my-org")
    expect(result.repo).toBe("my_repo")
  })

  it("handles HTTP URL (non-HTTPS)", () => {
    const result = parseRepoSlug("http://github.com/facebook/react")
    expect(result.owner).toBe("facebook")
    expect(result.repo).toBe("react")
    // Clone URL should still be HTTPS
    expect(result.cloneUrl).toBe("https://github.com/facebook/react.git")
  })

  it("throws on empty string", () => {
    expect(() => parseRepoSlug("")).toThrow("Invalid repo identifier")
  })

  it("throws on single word", () => {
    expect(() => parseRepoSlug("react")).toThrow("Invalid repo identifier")
  })

  it("throws on URL from non-GitHub host", () => {
    expect(() =>
      parseRepoSlug("https://gitlab.com/owner/repo")
    ).toThrow("Invalid repo identifier")
  })

  it("throws on URL with too many path segments", () => {
    expect(() =>
      parseRepoSlug("https://github.com/owner/repo/tree/main")
    ).toThrow("Invalid repo identifier")
  })

  it("throws on malformed SSH URL", () => {
    expect(() => parseRepoSlug("git@gitlab.com:owner/repo.git")).toThrow(
      "Invalid repo identifier"
    )
  })
})
