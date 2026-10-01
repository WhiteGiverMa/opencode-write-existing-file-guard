import { WriteExistingFileGuard, overwriteBlockedMessage, resolveGuardOptions } from "./guard"
import { isRecord, readPathFromArgs } from "./paths"

export type V2ExecuteBefore = {
  readonly tool: string
  readonly sessionID: string
  readonly input: unknown
}

export type V2ExecuteAfter = V2ExecuteBefore & {
  readonly status: "completed" | "error"
}

export type V2ToolHookRegistrar = {
  hook(
    name: "execute.before",
    callback: (event: V2ExecuteBefore) => Promise<void> | void,
  ): Promise<unknown>
  hook(
    name: "execute.after",
    callback: (event: V2ExecuteAfter) => Promise<void> | void,
  ): Promise<unknown>
}

export type V2Guard = {
  before(event: V2ExecuteBefore): Promise<void>
  after(event: V2ExecuteAfter): void
  dispose(): void
}

/**
 * v2 (`@opencode/plugin`) guard. `execute.before` may reject the tool call by
 * throwing; `execute.after` runs for both completed and failed calls, so read
 * approvals are recorded only for completed reads.
 */
export function createV2Guard(options: unknown, cwd: string): V2Guard | undefined {
  const resolved = resolveGuardOptions(options)
  if (!resolved.enabled) {
    return undefined
  }

  const guard = new WriteExistingFileGuard(resolved)

  return {
    before: async (event) => {
      if (event.tool.toLowerCase() !== "write") {
        return
      }

      const rawPath = readPathFromArgs(event.input)
      if (rawPath === undefined) {
        const candidate = isRecord(event.input) ? event.input.filePath ?? event.input.path ?? event.input.file_path : undefined
        if (typeof candidate === "string" && candidate.length > 0) {
          throw new Error("write-existing-file-guard: native write requires a nonblank file path.")
        }
        return
      }

      const decision = guard.authorizeWrite(event.sessionID, rawPath, cwd)
      if (!decision.allowed) {
        throw new Error(overwriteBlockedMessage(rawPath))
      }
    },
    after: (event) => {
      if (event.tool.toLowerCase() !== "read") {
        return
      }

      if (event.status !== "completed") {
        return
      }

      const rawPath = readPathFromArgs(event.input)
      if (rawPath === undefined) {
        return
      }

      guard.registerSuccessfulRead(event.sessionID, rawPath, cwd)
    },
    dispose: () => {
      guard.clear()
    },
  }
}

/**
 * Registers the v2 guard on a host tool domain. Returns a cleanup function
 * that drops all tracked approvals, or `undefined` when disabled so the host
 * registers no behavior at all.
 */
export async function registerV2Guard(
  tool: V2ToolHookRegistrar,
  cwd: string,
  options: unknown,
): Promise<(() => void) | undefined> {
  const guard = createV2Guard(options, cwd)
  if (guard === undefined) {
    return undefined
  }

  await tool.hook("execute.before", (event) => guard.before(event))
  await tool.hook("execute.after", (event) => guard.after(event))
  return () => guard.dispose()
}
