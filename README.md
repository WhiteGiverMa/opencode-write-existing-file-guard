# opencode-write-existing-file-guard

An OpenCode plugin that refuses to overwrite an existing file through the
native `write` tool until the **same session** has successfully **read** that
file. It is a small, original, MIT-licensed implementation with no runtime
dependencies beyond Node's standard library.

- New files are always allowed.
- An existing file is allowed once after a successful read in the same session
  (the approval is one-shot and is consumed by the write).
- Sessions cannot borrow each other's approvals.
- Symlink aliases resolve to one canonical identity, so reading the target
  approves a write through the link and vice versa.
- When a write is authorized, the same path's approval is dropped from every other
  session.
- The plugin can be fully disabled, in which case it registers **no** behavior.

## Compatibility

| Host | Version | Entry used | Hook surface |
| --- | --- | --- | --- |
| OpenCode v1, Linux and native Windows | 1.18.34 (`@opencode-ai/plugin`) | `dist/index.js` / `server()` | `tool.execute.before` / `tool.execute.after` |
| OpenCode v2, Linux | 2.0.21 (`@opencode/plugin`) | `v2-entry/` / `setup()` | `ctx.tool.hook("execute.before" / "execute.after")` |

Use the explicit entry for each host. The v1 bundle exposes `server()` and the
v2 wrapper exports an unambiguous `{ id, setup }` definition. Do not point v2
at the v1 package root: actual 2.0.21 did not load its combined object export.

The runtime bundle has no host imports; host packages are type-only
dependencies. `dist/index.js` is ESM, Node-compatible, and self-contained.

## Behavior in detail

Guarded tool: the native **`write`** tool only.

- v1 arguments are read from `filePath`, v2 from `path` (`file_path` is
  accepted as a legacy fallback).
- Meaningful leading/trailing spaces in filenames are preserved. A path made
  solely of whitespace is refused; missing or non-string input stays subject
  to native argument validation.
- Relative paths resolve against the host project directory
  (`PluginInput.directory` on v1, `context.location.directory` on v2, falling
  back to `process.cwd()`).

A read approval is recorded only when all of the following hold:

1. the tool is the native **`read`** tool,
2. the call completed successfully (v2 checks `status === "completed"`; the v1
   after-hook only fires after a successful execution),
3. the session id is present,
4. the target exists and is a regular file (a directory listing or a
   "file not found" result grants nothing).

On a `write`:

1. If the target does not exist, the write is allowed (new file). Any stale
   approvals for that path are dropped from other sessions.
2. If the target exists and the writing session holds an approval for the
   canonical path, the approval is consumed and the write is allowed. The
   approval is also dropped from every other session.
3. Otherwise the hook throws, and the host aborts the call before the file is
   touched. The error message is:
   `write-existing-file-guard: refusing to overwrite existing file "<path>". Read the file in this session first, or use the edit tool.`

Canonical identity: existing paths are fully `realpath`-resolved; for paths
that do not exist yet, the nearest existing ancestor is resolved and the
missing segments are re-appended. This keeps symlinked files and symlinked
parent directories consistent.

Bounded memory: at most `maxTrackedSessions` sessions (default 256, LRU
eviction) and at most `maxTrackedPathsPerSession` approvals per session
(default 1024, oldest-first eviction). State lives only in the plugin process
and is never persisted.

Cleanup:

- v1: `session.deleted` drops that session's approvals; `dispose()` clears
  everything.
- v2: the cleanup function returned from `setup()` clears everything; the host
  also disposes the registrations on unload.

Fail-closed: a `write` without a session id to an existing file is blocked,
because authorization cannot be proven.

## What this plugin does NOT guard

- The `edit` tool, `apply_patch`/`patch`, and any other partial-edit tool.
- Shell writers (`bash`, `shell`, `sh -c`, redirects, `sed -i`, ...).
- MCP tools, custom/plugin tools, and any non-`write` tool.
- Files changed directly on disk by other processes or plugins.
- Reads performed outside the native `read` tool (for example `cat` in a
  shell) do not create approvals.

In short: this is a guard for the native `write` path, nothing more. Do not
describe it as protecting shell or edit writes.

## Configuration

### v1 (`opencode.json` / `opencode.jsonc`)

```jsonc
{
  "plugin": [
    ["/absolute/path/to/opencode-write-existing-file-guard/dist/index.js", {}]
  ]
}
```

Or, when installed as a package:

```jsonc
{
  "plugin": [["opencode-write-existing-file-guard", { "enabled": true }]]
}
```

### v2 (`opencode.json`)

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-write-existing-file-guard/v2-entry",
      "options": { "enabled": true }
    }
  ]
}
```

Build first, then keep `v2-entry/` beside `dist/`; the wrapper re-exports
`dist/v2-entry.js`. These repositories have not been published to npm.

### Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | `false` disables the guard completely. |
| `maxTrackedSessions` | number | `256` | LRU cap on tracked sessions. |
| `maxTrackedPathsPerSession` | number | `1024` | Cap on approvals per session. |

Invalid bounds (non-number, non-finite, `< 1`) fall back to the default.
Fractional values are floored.

### Disable / rollback

- Set `"enabled": false` in the plugin options and restart the host. v1 then
  returns an empty hooks object; v2 registers no hooks and returns no cleanup.
- Or remove the plugin entry from the host configuration entirely.
- No state is persisted, so rollback has no files to clean up.

## Build and checks

```bash
bun install
bun run typecheck   # tsc --noEmit (strict)
bun test            # bun:test regression suite
bun run build       # dist/index.js (ESM, node target) + .d.ts files
bun run check       # typecheck + test + build
```

Node smoke check for the built artifact:

```bash
node -e "import('./dist/index.js').then(m => console.log(m.default.id, typeof m.default.server, typeof m.default.setup))"
```

## Limitations

- Relative-path resolution depends on the host providing the project directory
  to the plugin. Absolute paths are always resolved correctly.
- Approvals are per process and per session id; restarting the host clears
  them.
- There is no per-call bypass argument. The only escape hatch is disabling the
  plugin.
- Concurrent processes editing the same file outside OpenCode are not observed.
- The native `write` tool only: see the exclusion list above.

## Runtime verification

Real OpenCode sessions on the versions/platforms above were driven by a local
mock model calling the native tools, not by manually invoking fake hook
callbacks. Enabled and disabled cases covered unread overwrites, successful
read then write, consumed approvals, failed reads, new files and distinct
sessions. Actual file contents were checked. Linux host session count stayed
370 and Windows stayed571; HOME/USERPROFILE, XDG and databases were isolated.
No paid provider request or service restart was used. Task captures are kept
locally under `.omo/evidence/20261001-modular-guards/`; they are not published.

## License

MIT. This is an original implementation; see [LICENSE](./LICENSE). It was not
derived from, and does not import, any other plugin's source or prompts.
