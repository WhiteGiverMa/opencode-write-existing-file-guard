import { describe, expect, it } from "bun:test"
import { mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_MAX_TRACKED_PATHS_PER_SESSION,
  DEFAULT_MAX_TRACKED_SESSIONS,
  resolveGuardOptions,
  WriteExistingFileGuard,
} from "../src/guard"
import { cleanupTempDir, createFile, createTempDir, symlinksAvailable } from "./temp-workspace"

const symlinks = symlinksAvailable()

function createGuard(options: unknown = {}): WriteExistingFileGuard {
  return new WriteExistingFileGuard(resolveGuardOptions(options))
}

describe("resolveGuardOptions", () => {
  describe("#given no options", () => {
    it("#when resolved #then the guard is enabled with default bounds", () => {
      // given / when
      const resolved = resolveGuardOptions(undefined)

      // then
      expect(resolved.enabled).toBe(true)
      expect(resolved.maxTrackedSessions).toBe(DEFAULT_MAX_TRACKED_SESSIONS)
      expect(resolved.maxTrackedPathsPerSession).toBe(DEFAULT_MAX_TRACKED_PATHS_PER_SESSION)
    })
  })

  describe("#given enabled false", () => {
    it("#when resolved #then the guard is disabled", () => {
      // given / when / then
      expect(resolveGuardOptions({ enabled: false }).enabled).toBe(false)
    })
  })

  describe("#given invalid bounds", () => {
    it("#when resolved #then defaults are used", () => {
      // given
      const resolved = resolveGuardOptions({
        maxTrackedSessions: 0,
        maxTrackedPathsPerSession: Number.NaN,
      })

      // when / then
      expect(resolved.maxTrackedSessions).toBe(DEFAULT_MAX_TRACKED_SESSIONS)
      expect(resolved.maxTrackedPathsPerSession).toBe(DEFAULT_MAX_TRACKED_PATHS_PER_SESSION)
    })

    it("#when a bound is fractional #then it is floored", () => {
      // given / when / then
      expect(resolveGuardOptions({ maxTrackedSessions: 2.9 }).maxTrackedSessions).toBe(2)
    })
  })
})

describe("WriteExistingFileGuard", () => {
  describe("#given a new file", () => {
    it("#when a write is authorized without a read #then it is allowed", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const target = join(directory, "new.txt")

        // when
        const decision = guard.authorizeWrite("session-a", target, directory)

        // then
        expect(decision).toEqual({ allowed: true, reason: "new-file" })
      } finally {
        cleanupTempDir(directory)
      }
    })
  })

  describe("#given an existing file", () => {
    it("#when the session never read it #then the write is blocked", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const target = createFile(join(directory, "existing.txt"))

        // when
        const decision = guard.authorizeWrite("session-a", target, directory)

        // then
        expect(decision).toEqual({ allowed: false, reason: "unread-overwrite" })
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when a different session read it #then the write is blocked", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const target = createFile(join(directory, "existing.txt"))
        guard.registerSuccessfulRead("session-a", target, directory)

        // when
        const decision = guard.authorizeWrite("session-b", target, directory)

        // then
        expect(decision).toEqual({ allowed: false, reason: "unread-overwrite" })
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when the same session read it #then one write is allowed and the next is blocked", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const target = createFile(join(directory, "existing.txt"))
        guard.registerSuccessfulRead("session-a", target, directory)

        // when
        const first = guard.authorizeWrite("session-a", target, directory)
        const second = guard.authorizeWrite("session-a", target, directory)

        // then
        expect(first).toEqual({ allowed: true, reason: "read-grant" })
        expect(second).toEqual({ allowed: false, reason: "unread-overwrite" })
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when a read fails to find the file #then a later write is still blocked", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const target = join(directory, "later.txt")
        guard.registerSuccessfulRead("session-a", target, directory)
        createFile(target)

        // when
        const decision = guard.authorizeWrite("session-a", target, directory)

        // then
        expect(decision).toEqual({ allowed: false, reason: "unread-overwrite" })
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when the read target is a directory #then a write is blocked", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const target = join(directory, "folder")
        mkdirSync(target)
        guard.registerSuccessfulRead("session-a", target, directory)

        // when
        const decision = guard.authorizeWrite("session-a", target, directory)

        // then
        expect(decision).toEqual({ allowed: false, reason: "unread-overwrite" })
      } finally {
        cleanupTempDir(directory)
      }
    })
  })

  describe("#given a read grant and an intervening write", () => {
    it("#when another session held a grant #then the write invalidates it", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const target = createFile(join(directory, "shared.txt"))
        guard.registerSuccessfulRead("session-a", target, directory)
        guard.registerSuccessfulRead("session-b", target, directory)

        // when
        const first = guard.authorizeWrite("session-a", target, directory)
        const second = guard.authorizeWrite("session-b", target, directory)

        // then
        expect(first.allowed).toBe(true)
        expect(second).toEqual({ allowed: false, reason: "unread-overwrite" })
      } finally {
        cleanupTempDir(directory)
      }
    })
  })

  describe("#given canonical aliases", () => {
    it.skipIf(!symlinks)("#when the real file was read #then a write through the symlink is allowed", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const real = createFile(join(directory, "real.txt"))
        const alias = join(directory, "alias.txt")
        symlinkSync(real, alias)
        guard.registerSuccessfulRead("session-a", real, directory)

        // when
        const decision = guard.authorizeWrite("session-a", alias, directory)

        // then
        expect(decision).toEqual({ allowed: true, reason: "read-grant" })
      } finally {
        cleanupTempDir(directory)
      }
    })

    it.skipIf(!symlinks)("#when the symlink was read #then a write to the real file is allowed", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const real = createFile(join(directory, "real.txt"))
        const alias = join(directory, "alias.txt")
        symlinkSync(real, alias)
        guard.registerSuccessfulRead("session-a", alias, directory)

        // when
        const decision = guard.authorizeWrite("session-a", real, directory)

        // then
        expect(decision).toEqual({ allowed: true, reason: "read-grant" })
      } finally {
        cleanupTempDir(directory)
      }
    })

    it.skipIf(!symlinks)("#when the parent directory is aliased #then relative aliases share one identity", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const realDirectory = join(directory, "real")
        mkdirSync(realDirectory)
        const target = createFile(join(realDirectory, "file.txt"))
        const aliasDirectory = join(directory, "alias")
        symlinkSync(realDirectory, aliasDirectory)
        guard.registerSuccessfulRead("session-a", target, directory)

        // when
        const decision = guard.authorizeWrite("session-a", join(aliasDirectory, "file.txt"), directory)

        // then
        expect(decision).toEqual({ allowed: true, reason: "read-grant" })
      } finally {
        cleanupTempDir(directory)
      }
    })
  })

  describe("#given bounded session tracking", () => {
    it("#when the session cap is exceeded #then the least recently used session is evicted", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard({ maxTrackedSessions: 1 })
        const first = createFile(join(directory, "first.txt"))
        const second = createFile(join(directory, "second.txt"))
        guard.registerSuccessfulRead("session-a", first, directory)
        guard.registerSuccessfulRead("session-b", second, directory)

        // when
        const firstDecision = guard.authorizeWrite("session-a", first, directory)
        const secondDecision = guard.authorizeWrite("session-b", second, directory)

        // then
        expect(firstDecision).toEqual({ allowed: false, reason: "unread-overwrite" })
        expect(secondDecision).toEqual({ allowed: true, reason: "read-grant" })
      } finally {
        cleanupTempDir(directory)
      }
    })
  })

  describe("#given bounded path tracking", () => {
    it("#when the path cap is exceeded #then the oldest grant is dropped", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard({ maxTrackedPathsPerSession: 1 })
        const first = createFile(join(directory, "first.txt"))
        const second = createFile(join(directory, "second.txt"))
        guard.registerSuccessfulRead("session-a", first, directory)
        guard.registerSuccessfulRead("session-a", second, directory)

        // when
        const firstDecision = guard.authorizeWrite("session-a", first, directory)
        const secondDecision = guard.authorizeWrite("session-a", second, directory)

        // then
        expect(firstDecision).toEqual({ allowed: false, reason: "unread-overwrite" })
        expect(secondDecision).toEqual({ allowed: true, reason: "read-grant" })
      } finally {
        cleanupTempDir(directory)
      }
    })
  })

  describe("#given repeated reads", () => {
    it("#when the same file is read twice #then only one write is authorized", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const target = createFile(join(directory, "repeated.txt"))
        guard.registerSuccessfulRead("session-a", target, directory)
        guard.registerSuccessfulRead("session-a", target, directory)

        // when
        const first = guard.authorizeWrite("session-a", target, directory)
        const second = guard.authorizeWrite("session-a", target, directory)

        // then
        expect(first.allowed).toBe(true)
        expect(second.allowed).toBe(false)
      } finally {
        cleanupTempDir(directory)
      }
    })
  })

  describe("#given lifecycle cleanup", () => {
    it("#when a session is forgotten #then its grant is dropped", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const target = createFile(join(directory, "file.txt"))
        guard.registerSuccessfulRead("session-a", target, directory)

        // when
        guard.forgetSession("session-a")
        const decision = guard.authorizeWrite("session-a", target, directory)

        // then
        expect(decision.allowed).toBe(false)
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when the guard is cleared #then all grants are dropped", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const target = createFile(join(directory, "file.txt"))
        guard.registerSuccessfulRead("session-a", target, directory)

        // when
        guard.clear()
        const decision = guard.authorizeWrite("session-a", target, directory)

        // then
        expect(decision.allowed).toBe(false)
      } finally {
        cleanupTempDir(directory)
      }
    })
  })

  describe("#given a write without a session id", () => {
    it("#when the file exists #then the write is blocked", () => {
      // given
      const directory = createTempDir()
      try {
        const guard = createGuard()
        const target = createFile(join(directory, "file.txt"))

        // when
        const decision = guard.authorizeWrite(undefined, target, directory)

        // then
        expect(decision).toEqual({ allowed: false, reason: "unread-overwrite" })
      } finally {
        cleanupTempDir(directory)
      }
    })
  })
})
