import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { createV2Guard, registerV2Guard, type V2ExecuteAfter, type V2ExecuteBefore, type V2ToolHookRegistrar } from "../src/v2"
import { cleanupTempDir, createFile, createTempDir, expectRejected, expectResolved } from "./temp-workspace"

type HookSink = {
  before: Array<(event: V2ExecuteBefore) => Promise<void> | void>
  after: Array<(event: V2ExecuteAfter) => Promise<void> | void>
}

function createRegistrar(): { sink: HookSink; registrar: V2ToolHookRegistrar } {
  const sink: HookSink = { before: [], after: [] }
  const registrar: V2ToolHookRegistrar = {
    hook: (name, callback) => {
      if (name === "execute.before") {
        sink.before.push(callback as (event: V2ExecuteBefore) => Promise<void> | void)
      } else {
        sink.after.push(callback as (event: V2ExecuteAfter) => Promise<void> | void)
      }

      return Promise.resolve({})
    },
  }

  return { sink, registrar }
}

function requireGuard(options: unknown, cwd: string) {
  const guard = createV2Guard(options, cwd)
  if (guard === undefined) {
    throw new Error("expected the v2 guard to be enabled")
  }

  return guard
}

describe("createV2Guard", () => {
  describe("#given the guard is disabled", () => {
    it("#when the guard is created #then it is undefined", () => {
      // given / when / then
      expect(createV2Guard({ enabled: false }, process.cwd())).toBeUndefined()
    })
  })

  describe("#given an existing file", () => {
    it("#when the session never read it #then before rejects", async () => {
      // given
      const directory = createTempDir()
      try {
        const guard = requireGuard(undefined, directory)
        const target = createFile(join(directory, "existing.txt"))

        // when / then
        await expectRejected(
          () => guard.before({ tool: "write", sessionID: "session-a", input: { path: target, content: "next" } }),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when a completed read preceded it #then before passes", async () => {
      // given
      const directory = createTempDir()
      try {
        const guard = requireGuard(undefined, directory)
        const target = createFile(join(directory, "existing.txt"))
        guard.after({ tool: "read", sessionID: "session-a", input: { path: target }, status: "completed" })

        // when / then
        await expectResolved(() =>
          guard.before({ tool: "write", sessionID: "session-a", input: { path: target, content: "next" } }),
        )
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when the read failed #then before rejects", async () => {
      // given
      const directory = createTempDir()
      try {
        const guard = requireGuard(undefined, directory)
        const target = createFile(join(directory, "existing.txt"))
        guard.after({ tool: "read", sessionID: "session-a", input: { path: target }, status: "error" })

        // when / then
        await expectRejected(
          () => guard.before({ tool: "write", sessionID: "session-a", input: { path: target, content: "next" } }),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when another session read it #then before rejects", async () => {
      // given
      const directory = createTempDir()
      try {
        const guard = requireGuard(undefined, directory)
        const target = createFile(join(directory, "existing.txt"))
        guard.after({ tool: "read", sessionID: "session-a", input: { path: target }, status: "completed" })

        // when / then
        await expectRejected(
          () => guard.before({ tool: "write", sessionID: "session-b", input: { path: target, content: "next" } }),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })
  })

  describe("#given relative paths", () => {
    it("#when both calls resolve against the host directory #then the grant applies", async () => {
      // given
      const directory = createTempDir()
      try {
        const guard = requireGuard(undefined, directory)
        createFile(join(directory, "relative.txt"))
        guard.after({ tool: "read", sessionID: "session-a", input: { path: "relative.txt" }, status: "completed" })

        // when / then
        await expectResolved(() =>
          guard.before({ tool: "write", sessionID: "session-a", input: { path: "relative.txt", content: "next" } }),
        )
      } finally {
        cleanupTempDir(directory)
      }
    })
  })

  describe("#given lifecycle cleanup", () => {
    it("#when the guard is disposed #then grants are dropped", async () => {
      // given
      const directory = createTempDir()
      try {
        const guard = requireGuard(undefined, directory)
        const target = createFile(join(directory, "existing.txt"))
        guard.after({ tool: "read", sessionID: "session-a", input: { path: target }, status: "completed" })

        // when
        guard.dispose()

        // then
        await expectRejected(
          () => guard.before({ tool: "write", sessionID: "session-a", input: { path: target, content: "next" } }),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })
  })
})

describe("registerV2Guard", () => {
  describe("#given the guard is disabled", () => {
    it("#when hooks are registered #then nothing is registered", async () => {
      // given
      const { sink, registrar } = createRegistrar()

      // when
      const cleanup = await registerV2Guard(registrar, process.cwd(), { enabled: false })

      // then
      expect(cleanup).toBeUndefined()
      expect(sink.before).toHaveLength(0)
      expect(sink.after).toHaveLength(0)
    })
  })

  describe("#given the guard is enabled", () => {
    it("#when hooks are registered #then both lifecycle hooks are wired", async () => {
      // given
      const { sink, registrar } = createRegistrar()

      // when
      const cleanup = await registerV2Guard(registrar, process.cwd(), undefined)

      // then
      expect(cleanup).toBeFunction()
      expect(sink.before).toHaveLength(1)
      expect(sink.after).toHaveLength(1)
    })

    it("#when the cleanup runs #then tracked grants are dropped", async () => {
      // given
      const directory = createTempDir()
      try {
        const { sink, registrar } = createRegistrar()
        const target = createFile(join(directory, "existing.txt"))
        const cleanup = await registerV2Guard(registrar, directory, undefined)
        if (cleanup === undefined) {
          throw new Error("expected cleanup to be returned")
        }

        const after = sink.after[0]
        const before = sink.before[0]
        if (after === undefined || before === undefined) {
          throw new Error("expected both hooks to be registered")
        }

        await after({ tool: "read", sessionID: "session-a", input: { path: target }, status: "completed" })

        // when
        cleanup()

        // then
        await expectRejected(
          () => before({ tool: "write", sessionID: "session-a", input: { path: target, content: "next" } }),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })
  })
})
