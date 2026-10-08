import type { Hooks, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import type { Context as PluginContextV2, Cleanup } from "@opencode/plugin/promise/plugin"
import { createV1Hooks } from "./v1"
import { registerV2Guard } from "./v2"

export const id = "o3p.tool.write-existing-file-guard"

/**
 * v1 entry. OpenCode 1.x loads the default export and calls `server()`.
 * `enabled: false` yields an empty hooks object, so nothing is registered.
 */
async function server(input: PluginInput, options?: PluginOptions): Promise<Hooks> {
  return createV1Hooks(input.directory, options)
}

/**
 * v2 entry. OpenCode 2.x loads the default export and calls `setup()`.
 * `enabled: false` registers no hooks and returns no cleanup.
 */
async function setup(context: PluginContextV2): Promise<Cleanup | undefined> {
  const cwd = context.location?.directory ?? process.cwd()
  return registerV2Guard(context.tool, cwd, context.options)
}

export { server, setup }
export { createV1Hooks, readDeletedSessionID } from "./v1"
export { createV2Guard, registerV2Guard } from "./v2"
export {
  DEFAULT_MAX_TRACKED_PATHS_PER_SESSION,
  DEFAULT_MAX_TRACKED_SESSIONS,
  overwriteBlockedMessage,
  resolveGuardOptions,
  WriteExistingFileGuard,
} from "./guard"
export { canonicalizePath, isExistingFile, readPathFromArgs, resolveAbsolutePath } from "./paths"
export type { ResolvedGuardOptions, WriteDecision } from "./guard"
export type { V2ExecuteAfter, V2ExecuteBefore, V2Guard, V2ToolHookRegistrar } from "./v2"

const pluginModule = { id, server, setup }

export default pluginModule
