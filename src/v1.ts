import type { Hooks } from "@opencode-ai/plugin"
import { WriteExistingFileGuard, overwriteBlockedMessage, resolveGuardOptions } from "./guard"
import { isRecord, readPathFromArgs } from "./paths"

/**
 * v1 (`@opencode-ai/plugin`) adapter. Returns a hook object for the OpenCode
 * `server()` contract. When the guard is disabled it returns an empty object,
 * so the host registers no behavior at all.
 */
export function createV1Hooks(cwd: string, options: unknown): Hooks {
  const resolved = resolveGuardOptions(options)
  if (!resolved.enabled) {
    return {}
  }

  const guard = new WriteExistingFileGuard(resolved)

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool.toLowerCase() !== "write") {
        return
      }

      const rawPath = readPathFromArgs(output.args)
      if (rawPath === undefined) {
        const candidate = isRecord(output.args) ? output.args.filePath ?? output.args.path ?? output.args.file_path : undefined
        if (typeof candidate === "string" && candidate.length > 0) {
          throw new Error("write-existing-file-guard: native write requires a nonblank file path.")
        }
        return
      }

      const decision = guard.authorizeWrite(input.sessionID, rawPath, cwd)
      if (!decision.allowed) {
        throw new Error(overwriteBlockedMessage(rawPath))
      }
    },
    "tool.execute.after": async (input) => {
      if (input.tool.toLowerCase() !== "read") {
        return
      }

      const rawPath = readPathFromArgs(input.args)
      if (rawPath === undefined) {
        return
      }

      guard.registerSuccessfulRead(input.sessionID, rawPath, cwd)
    },
    event: async ({ event }) => {
      const sessionID = readDeletedSessionID(event)
      if (sessionID !== undefined) {
        guard.forgetSession(sessionID)
      }
    },
    dispose: async () => {
      guard.clear()
    },
  }
}

export function readDeletedSessionID(event: unknown): string | undefined {
  if (!isRecord(event) || event.type !== "session.deleted") {
    return undefined
  }

  const properties = isRecord(event.properties) ? event.properties : undefined
  if (properties === undefined) {
    return undefined
  }

  const info = isRecord(properties.info) ? properties.info : undefined
  if (info !== undefined && typeof info.id === "string" && info.id.length > 0) {
    return info.id
  }

  if (typeof properties.sessionID === "string" && properties.sessionID.length > 0) {
    return properties.sessionID
  }

  if (typeof properties.id === "string" && properties.id.length > 0) {
    return properties.id
  }

  return undefined
}
