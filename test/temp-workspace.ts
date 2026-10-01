import { expect } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "write-guard-"))
}

export function cleanupTempDir(directory: string): void {
  rmSync(directory, { recursive: true, force: true })
}

export function createFile(path: string, content = "original content"): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

export async function expectRejected(action: () => unknown, pattern: RegExp): Promise<void> {
  let error: unknown
  try {
    await Promise.resolve(action())
  } catch (caught) {
    error = caught
  }

  if (!(error instanceof Error)) {
    throw new Error(`expected the action to reject with an Error, received ${String(error)}`)
  }

  expect(error.message).toMatch(pattern)
}

export async function expectResolved(action: () => unknown): Promise<void> {
  await Promise.resolve(action())
}

export function symlinksAvailable(): boolean {
  const directory = mkdtempSync(join(tmpdir(), "write-guard-link-"))
  try {
    const target = join(directory, "target.txt")
    writeFileSync(target, "content")
    symlinkSync(target, join(directory, "link.txt"))
    return true
  } catch {
    return false
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
