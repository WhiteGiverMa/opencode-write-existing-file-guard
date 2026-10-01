import { existsSync } from "node:fs"
import { canonicalizePath, isExistingFile, isRecord, resolveAbsolutePath } from "./paths"

export const DEFAULT_MAX_TRACKED_SESSIONS = 256
export const DEFAULT_MAX_TRACKED_PATHS_PER_SESSION = 1024

export type ResolvedGuardOptions = {
  readonly enabled: boolean
  readonly maxTrackedSessions: number
  readonly maxTrackedPathsPerSession: number
}

export type WriteDecision =
  | { readonly allowed: true; readonly reason: "new-file" | "read-grant" }
  | { readonly allowed: false; readonly reason: "unread-overwrite" }

export function resolveGuardOptions(options: unknown): ResolvedGuardOptions {
  const record = isRecord(options) ? options : {}
  return {
    enabled: record.enabled !== false,
    maxTrackedSessions: normalizeBound(record.maxTrackedSessions, DEFAULT_MAX_TRACKED_SESSIONS),
    maxTrackedPathsPerSession: normalizeBound(
      record.maxTrackedPathsPerSession,
      DEFAULT_MAX_TRACKED_PATHS_PER_SESSION,
    ),
  }
}

export function overwriteBlockedMessage(rawPath: string): string {
  return `write-existing-file-guard: refusing to overwrite existing file "${rawPath}". Read the file in this session first, or use the edit tool.`
}

/**
 * Per-session read approvals. A successful read of an existing regular file
 * records a one-shot approval for that canonical path; a write to an existing
 * file is allowed only when the writing session holds that approval, and the
 * approval is consumed by the write. Sessions are isolated, approvals are
 * dropped from other sessions when a write lands, and both maps are bounded.
 */
export class WriteExistingFileGuard {
  private readonly readsBySession = new Map<string, Set<string>>()
  private readonly lastAccess = new Map<string, number>()
  private clock = 0
  private readonly maxTrackedSessions: number
  private readonly maxTrackedPathsPerSession: number

  constructor(options: ResolvedGuardOptions) {
    this.maxTrackedSessions = options.maxTrackedSessions
    this.maxTrackedPathsPerSession = options.maxTrackedPathsPerSession
  }

  registerSuccessfulRead(sessionID: string | undefined, rawPath: string, cwd: string): void {
    if (sessionID === undefined || sessionID.length === 0) {
      return
    }

    const canonicalPath = canonicalizePath(resolveAbsolutePath(cwd, rawPath))
    if (!isExistingFile(canonicalPath)) {
      return
    }

    const reads = this.ensureSession(sessionID)
    reads.delete(canonicalPath)
    reads.add(canonicalPath)
    this.trimSession(reads)
  }

  authorizeWrite(sessionID: string | undefined, rawPath: string, cwd: string): WriteDecision {
    const canonicalPath = canonicalizePath(resolveAbsolutePath(cwd, rawPath))
    if (!existsSync(canonicalPath)) {
      this.invalidateOtherSessions(canonicalPath, sessionID)
      return { allowed: true, reason: "new-file" }
    }

    const reads = sessionID === undefined ? undefined : this.readsBySession.get(sessionID)
    if (sessionID !== undefined && reads?.has(canonicalPath)) {
      reads.delete(canonicalPath)
      this.touch(sessionID)
      this.invalidateOtherSessions(canonicalPath, sessionID)
      return { allowed: true, reason: "read-grant" }
    }

    return { allowed: false, reason: "unread-overwrite" }
  }

  forgetSession(sessionID: string): void {
    this.readsBySession.delete(sessionID)
    this.lastAccess.delete(sessionID)
  }

  clear(): void {
    this.readsBySession.clear()
    this.lastAccess.clear()
    this.clock = 0
  }

  private ensureSession(sessionID: string): Set<string> {
    let reads = this.readsBySession.get(sessionID)
    if (reads === undefined) {
      if (this.readsBySession.size >= this.maxTrackedSessions) {
        this.evictLeastRecentlyUsedSession()
      }

      reads = new Set()
      this.readsBySession.set(sessionID, reads)
    }

    this.touch(sessionID)
    return reads
  }

  private trimSession(reads: Set<string>): void {
    while (reads.size > this.maxTrackedPathsPerSession) {
      const oldest = reads.values().next().value
      if (oldest === undefined) {
        return
      }

      reads.delete(oldest)
    }
  }

  private touch(sessionID: string): void {
    this.clock += 1
    this.lastAccess.set(sessionID, this.clock)
  }

  private evictLeastRecentlyUsedSession(): void {
    let oldestSessionID: string | undefined
    let oldestClock = Number.POSITIVE_INFINITY
    for (const [sessionID, lastSeen] of this.lastAccess) {
      if (lastSeen < oldestClock) {
        oldestClock = lastSeen
        oldestSessionID = sessionID
      }
    }

    if (oldestSessionID !== undefined) {
      this.forgetSession(oldestSessionID)
    }
  }

  private invalidateOtherSessions(canonicalPath: string, writingSessionID: string | undefined): void {
    for (const [sessionID, reads] of this.readsBySession) {
      if (sessionID === writingSessionID) {
        continue
      }

      reads.delete(canonicalPath)
    }
  }
}

function normalizeBound(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback
  }

  return Math.floor(value)
}
