import { describe, it, expect } from "bun:test"
import { extractGitError } from "../src/git-error"

describe("extractGitError", () => {
  it("extracts stderr from a Bun ShellError-like object", () => {
    const fakeErr = {
      message: "Failed with exit code 128",
      stderr: Buffer.from(
        "fatal: repository 'https://github.com/foo/bar.git/' not found\n"
      ),
    }

    const { stderr, detail } = extractGitError(fakeErr)

    expect(stderr).toBe(
      "fatal: repository 'https://github.com/foo/bar.git/' not found"
    )
    expect(detail).toBe(
      "fatal: repository 'https://github.com/foo/bar.git/' not found"
    )
  })

  it("prefers stderr over message when both are present", () => {
    const fakeErr = {
      message: "Failed with exit code 128",
      stderr: Buffer.from("fatal: could not read Username\n"),
    }

    const { stderr, detail } = extractGitError(fakeErr)

    expect(stderr).toBe("fatal: could not read Username")
    expect(detail).toBe("fatal: could not read Username")
  })

  it("falls back to message when stderr is empty", () => {
    const fakeErr = {
      message: "Failed with exit code 1",
      stderr: Buffer.from(""),
    }

    const { stderr, detail } = extractGitError(fakeErr)

    expect(stderr).toBe("")
    expect(detail).toBe("Failed with exit code 1")
  })

  it("falls back to message when stderr is not present", () => {
    const fakeErr = {
      message: "Some other error",
    }

    const { stderr, detail } = extractGitError(fakeErr)

    expect(stderr).toBe("")
    expect(detail).toBe("Some other error")
  })

  it("falls back to stringified error when no message or stderr", () => {
    const fakeErr = "raw string error"

    const { stderr, detail } = extractGitError(fakeErr)

    expect(stderr).toBe("")
    expect(detail).toBe("raw string error")
  })

  it("handles null/undefined error gracefully", () => {
    const { stderr: s1, detail: d1 } = extractGitError(null)
    expect(s1).toBe("")
    expect(d1).toBe("null")

    const { stderr: s2, detail: d2 } = extractGitError(undefined)
    expect(s2).toBe("")
    expect(d2).toBe("undefined")
  })

  it("handles stderr with only whitespace", () => {
    const fakeErr = {
      message: "Failed with exit code 128",
      stderr: Buffer.from("   \n  \n  "),
    }

    const { stderr, detail } = extractGitError(fakeErr)

    expect(stderr).toBe("")
    expect(detail).toBe("Failed with exit code 128")
  })

  it("preserves multi-line stderr messages", () => {
    const multiLine =
      "fatal: repository 'https://github.com/foo/bar.git/' not found\n" +
      "remote: Repository not found."
    const fakeErr = {
      message: "Failed with exit code 128",
      stderr: Buffer.from(multiLine + "\n"),
    }

    const { stderr, detail } = extractGitError(fakeErr)

    expect(stderr).toBe(multiLine)
    expect(detail).toBe(multiLine)
  })

  it("detail includes 'not found' when stderr contains it (used for repo-not-found detection)", () => {
    const fakeErr = {
      message: "Failed with exit code 128",
      stderr: Buffer.from(
        "remote: Repository not found.\nfatal: repository 'https://github.com/x/y.git/' not found\n"
      ),
    }

    const { detail } = extractGitError(fakeErr)

    expect(detail.includes("not found")).toBe(true)
    expect(detail.includes("Repository not found")).toBe(true)
  })

  it("detail includes 'authentication' when stderr contains credential errors", () => {
    const fakeErr = {
      message: "Failed with exit code 128",
      stderr: Buffer.from(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n"
      ),
    }

    const { detail } = extractGitError(fakeErr)

    expect(detail.includes("could not read Username")).toBe(true)
  })
})
