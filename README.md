# opencode-write-existing-file-guard

[English](README.en.md) | **简体中文**

一个 OpenCode 插件：在**同一会话**成功**读取**某个已存在的文件之前，拒绝通过原生 `write` 工具覆盖它。实现小巧，MIT 许可，除 Node 标准库外无运行时依赖。

- 新文件始终允许写入。
- 已存在的文件在同一会话成功读取后允许写入一次（批准是一次性的，写入即消费）。
- 会话之间不能借用彼此的批准。
- 符号链接别名解析为同一个规范身份，因此读取目标文件即批准通过链接写入，反之亦然。
- 一次写入被授权后，该路径的批准会从其他所有会话中移除。
- 插件可以完全禁用，禁用时不注册任何行为。

## 兼容性

| 宿主 | 版本 | 入口 | 钩子面 |
| --- | --- | --- | --- |
| OpenCode v1，Linux 与原生 Windows | 1.18.34（`@opencode-ai/plugin`） | `dist/index.js` / `server()` | `tool.execute.before` / `tool.execute.after` |
| OpenCode v2，Linux | 2.0.21（`@opencode/plugin`） | `v2-entry/` / `setup()` | `ctx.tool.hook("execute.before" / "execute.after")` |

请为各宿主使用对应的显式入口。v1 包导出 `server()`，v2 包装导出明确的 `{ id, setup }` 定义。不要把 v2 指向 v1 包根：实测 2.0.21 无法加载它的组合对象导出。

运行时包不含宿主导入；宿主包仅为类型依赖。`dist/index.js` 是 ESM、Node 兼容、自包含的。

## 行为细节

被守护的工具：仅原生 **`write`** 工具。

- v1 参数读自 `filePath`，v2 读自 `path`（`file_path` 作为遗留回退也接受）。
- 文件名中有意义的首尾空格会被保留；纯空白路径会被拒绝；缺失或非字符串输入交给原生参数校验。
- 相对路径按宿主项目目录解析（v1 的 `PluginInput.directory`，v2 的 `context.location.directory`，回退到 `process.cwd()`）。

一次读取满足以下全部条件时才记录批准：

1. 工具是原生 **`read`** 工具；
2. 调用成功完成（v2 检查 `status === "completed"`；v1 的 after-hook 只在成功执行后触发）；
3. 会话 id 存在；
4. 目标存在且是普通文件（目录列举或「文件不存在」的结果不产生批准）。

一次 `write` 时：

1. 目标不存在 → 允许（新文件）。该路径在其他会话中的残留批准被清除。
2. 目标存在且写入会话持有该规范路径的批准 → 消费批准并允许写入，同时从其他所有会话中移除该批准。
3. 否则钩子抛错，宿主在触碰文件之前中止调用。错误消息为：
   `write-existing-file-guard: refusing to overwrite existing file "<path>". Read the file in this session first, or use the edit tool.`

规范身份：已存在的路径做完整 `realpath` 解析；尚不存在的路径解析最近的已存在祖先，再把缺失的部分拼回去。符号链接的文件与符号链接的父目录因此保持一致。

内存有界：最多跟踪 `maxTrackedSessions` 个会话（默认 256，LRU 淘汰），每个会话最多 `maxTrackedPathsPerSession` 条批准（默认 1024，先进先出淘汰）。状态只存在于插件进程内，从不持久化。

清理：

- v1：`session.deleted` 清除该会话的批准；`dispose()` 清空全部。
- v2：`setup()` 返回的清理函数清空全部；宿主卸载时也会处置注册项。

失败即关闭：没有会话 id 的 `write` 写入已存在文件时会被阻止，因为无法证明授权。

## 本插件不守护的范围

- `edit` 工具、`apply_patch`/`patch` 及任何其他局部编辑工具。
- shell 写入（`bash`、`shell`、`sh -c`、重定向、`sed -i` 等）。
- MCP 工具、自定义/插件工具，以及任何非 `write` 工具。
- 其他进程或插件直接在磁盘上修改的文件。
- 通过原生 `read` 以外的方式（例如 shell 里的 `cat`）进行的读取不产生批准。

也就是说：这是原生 `write` 路径的守卫，仅此而已。

## 配置

### v1（`opencode.json` / `opencode.jsonc`）

```jsonc
{
  "plugin": [
    ["/absolute/path/to/opencode-write-existing-file-guard/dist/index.js", {}]
  ]
}
```

作为包安装时：

```jsonc
{
  "plugin": [["opencode-write-existing-file-guard", { "enabled": true }]]
}
```

### v2（`opencode.json`）

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

先构建，并让 `v2-entry/` 与 `dist/` 保持相邻；包装入口 re-export `dist/v2-entry.js`。

### 选项

| 选项 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | `false` 完全禁用守卫。 |
| `maxTrackedSessions` | number | `256` | 跟踪会话数的 LRU 上限。 |
| `maxTrackedPathsPerSession` | number | `1024` | 每个会话的批准数上限。 |

非法取值（非数字、非有限、`< 1`）回落到默认值；小数值向下取整。

### 禁用 / 回滚

- 在插件选项中设置 `"enabled": false` 并重启宿主。v1 随即返回空钩子对象；v2 不注册钩子、不返回清理函数。
- 或从宿主配置中整体删除插件条目。
- 没有持久化状态，回滚无需清理任何文件。

## 构建与检查

```bash
bun install
bun run typecheck   # tsc --noEmit（严格模式）
bun test            # bun:test 回归套件
bun run build       # dist/index.js（ESM，node target）+ .d.ts
bun run check       # typecheck + test + build
```

构建产物的 Node 冒烟检查：

```bash
node -e "import('./dist/index.js').then(m => console.log(m.default.id, typeof m.default.server, typeof m.default.setup))"
```

## 限制

- 相对路径解析依赖宿主向插件提供项目目录；绝对路径总能正确解析。
- 批准按进程、按会话 id 记录；重启宿主即清空。
- 没有按调用绕过的参数，唯一的逃生口是禁用插件。
- 在 OpenCode 之外并发修改同一文件的进程不可观察。
- 只守护原生 `write` 工具，见上方排除清单。

## 运行时验证

在上述版本/平台上，由本地 mock 模型驱动真实 OpenCode 会话调用原生工具完成验证。启用与禁用两种情况覆盖了：未读覆盖、先读后写、批准消费、读取失败、新文件与不同会话，并检查了真实文件内容。全程隔离了 HOME/USERPROFILE、XDG 与数据库。

## 许可

MIT，见 [LICENSE](./LICENSE)。
