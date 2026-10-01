import { describe, expect, it } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"
import { join } from "node:path"
import { createV1Hooks, readDeletedSessionID } from "../src/v1"
import { cleanupTempDir, createFile, createTempDir, expectRejected, expectResolved } from "./temp-workspace"

type BeforeHook = NonNullable<Hooks["tool.execute.before"]>
type AfterHook = NonNullable<Hooks["tool.execute.after"]>
type EventHookInput = Parameters<NonNullable<Hooks["event"]>>[0]

function requireBefore(hooks: Hooks): BeforeHook {
  const hook = hooks["tool.execute.before"]
  if (hook === undefined) {
    throw new Error("expected tool.execute.before to be registered")
  }

  return hook
}

function requireAfter(hooks: Hooks): AfterHook {
  const hook = hooks["tool.execute.after"]
  if (hook === undefined) {
    throw new Error("expected tool.execute.after to be registered")
  }

  return hook
}

function deletedEvent(sessionID: string): EventHookInput {
  return {
    event: { type: "session.deleted", properties: { info: { id: sessionID } } },
  } as unknown as EventHookInput
}

function writeCall(sessionID: string, filePath: string): Parameters<BeforeHook> {
  return [{ tool: "write", sessionID, callID: "call-write" }, { args: { filePath, content: "next" } }]
}

function readCall(sessionID: string, filePath: string): Parameters<AfterHook> {
  return [
    { tool: "read", sessionID, callID: "call-read", args: { filePath } },
    { title: "read", output: "content", metadata: {} },
  ]
}

describe("createV1Hooks", () => {
  describe("#given the guard is disabled", () => {
    it("#when hooks are created #then no behavior is registered", () => {
      // given
      const directory = createTempDir()
      try {
        // when
        const hooks = createV1Hooks(directory, { enabled: false })

        // then
        expect(Object.keys(hooks)).toHaveLength(0)
      } finally {
        cleanupTempDir(directory)
      }
    })
  })

  describe("#given the guard is enabled", () => {
    it("#when hooks are created #then before, after, event, and dispose are registered", () => {
      // given
      const directory = createTempDir()
      try {
        // when
        const hooks = createV1Hooks(directory, undefined)

        // then
        expect(hooks["tool.execute.before"]).toBeFunction()
        expect(hooks["tool.execute.after"]).toBeFunction()
        expect(hooks.event).toBeFunction()
        expect(hooks.dispose).toBeFunction()
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when an unread existing file is written #then the write is rejected", async () => {
      // given
      const directory = createTempDir()
      try {
        const hooks = createV1Hooks(directory, undefined)
        const target = createFile(join(directory, "existing.txt"))

        // when / then
        await expectRejected(
          () => requireBefore(hooks)(...writeCall("session-a", target)),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when a new file is written #then the write passes", async () => {
      // given
      const directory = createTempDir()
      try {
        const hooks = createV1Hooks(directory, undefined)
        const target = join(directory, "new.txt")

        // when / then
        await expectResolved(() => requireBefore(hooks)(...writeCall("session-a", target)))
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when the same session read the file #then one write passes and the next is rejected", async () => {
      // given
      const directory = createTempDir()
      try {
        const hooks = createV1Hooks(directory, undefined)
        const target = createFile(join(directory, "existing.txt"))
        await requireAfter(hooks)(...readCall("session-a", target))

        // when / then
        await expectResolved(() => requireBefore(hooks)(...writeCall("session-a", target)))
        await expectRejected(
          () => requireBefore(hooks)(...writeCall("session-a", target)),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when another session read the file #then the write is rejected", async () => {
      // given
      const directory = createTempDir()
      try {
        const hooks = createV1Hooks(directory, undefined)
        const target = createFile(join(directory, "existing.txt"))
        await requireAfter(hooks)(...readCall("session-a", target))

        // when / then
        await expectRejected(
          () => requireBefore(hooks)(...writeCall("session-b", target)),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when the read found no file #then a later write is rejected", async () => {
      // given
      const directory = createTempDir()
      try {
        const hooks = createV1Hooks(directory, undefined)
        const target = join(directory, "later.txt")
        await requireAfter(hooks)(...readCall("session-a", target))
        createFile(target)

        // when / then
        await expectRejected(
          () => requireBefore(hooks)(...writeCall("session-a", target)),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when the session was deleted #then its grant is dropped", async () => {
      // given
      const directory = createTempDir()
      try {
        const hooks = createV1Hooks(directory, undefined)
        const target = createFile(join(directory, "existing.txt"))
        await requireAfter(hooks)(...readCall("session-a", target))

        // when
        await hooks.event?.(deletedEvent("session-a"))

        // then
        await expectRejected(
          () => requireBefore(hooks)(...writeCall("session-a", target)),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when the plugin is disposed #then all grants are dropped", async () => {
      // given
      const directory = createTempDir()
      try {
        const hooks = createV1Hooks(directory, undefined)
        const target = createFile(join(directory, "existing.txt"))
        await requireAfter(hooks)(...readCall("session-a", target))

        // when
        await hooks.dispose?.()

        // then
        await expectRejected(
          () => requireBefore(hooks)(...writeCall("session-a", target)),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when a non-write tool runs #then the guard stays quiet", async () => {
      // given
      const directory = createTempDir()
      try {
        const hooks = createV1Hooks(directory, undefined)
        const target = createFile(join(directory, "existing.txt"))

        // when / then
        await expectResolved(() =>
          requireBefore(hooks)(
            { tool: "bash", sessionID: "session-a", callID: "call-bash" },
            { args: { command: "rm -rf /" } },
          ),
        )
        await expectResolved(() =>
          requireBefore(hooks)({ tool: "write", sessionID: "session-a", callID: "call-write" }, { args: {} }),
        )
        expect(target.length).toBeGreaterThan(0)
      } finally {
        cleanupTempDir(directory)
      }
    })

    it("#when a read reports an unrelated tool #then no grant is recorded", async () => {
      // given
      const directory = createTempDir()
      try {
        const hooks = createV1Hooks(directory, undefined)
        const target = createFile(join(directory, "existing.txt"))

        // when
        await requireAfter(hooks)(
          { tool: "grep", sessionID: "session-a", callID: "call-grep", args: { filePath: target } },
          { title: "grep", output: "hit", metadata: {} },
        )

        // then
        await expectRejected(
          () => requireBefore(hooks)(...writeCall("session-a", target)),
          /refusing to overwrite existing file/,
        )
      } finally {
        cleanupTempDir(directory)
      }
    })
  })
})

describe("readDeletedSessionID", () => {
  it("#given a v1 session.deleted event #then the session id is returned", () => {
    // given / when / then
    expect(readDeletedSessionID({ type: "session.deleted", properties: { info: { id: "session-a" } } })).toBe(
      "session-a",
    )
  })

  it("#given fallback id shapes #then they are honored", () => {
    // given / when / then
    expect(readDeletedSessionID({ type: "session.deleted", properties: { sessionID: "session-b" } })).toBe("session-b")
    expect(readDeletedSessionID({ type: "session.deleted", properties: { id: "session-c" } })).toBe("session-c")
  })

  it("#given other events or malformed payloads #then undefined is returned", () => {
    // given / when / then
    expect(readDeletedSessionID({ type: "session.idle", properties: { info: { id: "session-a" } } })).toBeUndefined()
    expect(readDeletedSessionID({ type: "session.deleted" })).toBeUndefined()
    expect(readDeletedSessionID(null)).toBeUndefined()
  })
})
