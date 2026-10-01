import { existsSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path"

/**
 * Tool arguments may name the target file in any of the shapes used by the
 * supported hosts: v1 `write`/`read` use `filePath`, v2 uses `path`. Some
 * hosts have historically used `file_path`; it is accepted as a fallback.
 */
export function readPathFromArgs(args: unknown): string | undefined {
  if (!isRecord(args)) {
    return undefined
  }

  const candidate = args.filePath ?? args.path ?? args.file_path
  if (typeof candidate !== "string") {
    return undefined
  }

  return candidate.trim().length > 0 ? candidate : undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function resolveAbsolutePath(cwd: string, rawPath: string): string {
  return normalize(isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath))
}

/**
 * Resolves a path to a stable identity. Existing paths are fully realpath'd,
 * so a symlink and its target share one canonical identity. When the target
 * does not exist yet, the nearest existing ancestor is realpath'd and the
 * missing segments are re-appended, which keeps aliases through symlinked
 * parent directories consistent.
 */
export function canonicalizePath(absolutePath: string): string {
  const existing = tryRealpath(absolutePath)
  if (existing !== undefined) {
    return existing
  }

  const missing: string[] = []
  let current = absolutePath
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) {
      return normalize(absolutePath)
    }

    missing.unshift(basename(current))
    current = parent
  }

  const base = tryRealpath(current) ?? normalize(current)
  return normalize(join(base, ...missing))
}

export function isExistingFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function tryRealpath(path: string): string | undefined {
  try {
    return normalize(realpathSync.native(path))
  } catch {
    return undefined
  }
}
