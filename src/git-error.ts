/**
 * Extract a meaningful error detail from a Bun ShellError.
 *
 * Bun's `$` shell throws a ShellError on non-zero exit codes.
 * When `.quiet()` is used, stdout/stderr are still available on the
 * error object as Buffer properties. This helper extracts stderr first
 * (where Git writes its diagnostics), falling back to the error message
 * or stringified error.
 */
export function extractGitError(err: unknown): { stderr: string; detail: string } {
  const e = err as Record<string, unknown> | undefined
  const stderr =
    e?.stderr && typeof (e.stderr as Buffer).toString === "function"
      ? Buffer.from(e.stderr as Buffer)
          .toString("utf-8")
          .trim()
      : ""

  const message =
    typeof (e as any)?.message === "string" ? (e as any).message : String(err)

  const detail = stderr || message

  return { stderr, detail }
}
