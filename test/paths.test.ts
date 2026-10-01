import { describe, expect, it } from "bun:test"
import { mkdirSync, realpathSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { canonicalizePath, isExistingFile, readPathFromArgs, resolveAbsolutePath } from "../src/paths"
import { cleanupTempDir, createFile, createTempDir, symlinksAvailable } from "./temp-workspace"

const symlinks = symlinksAvailable()

describe("readPathFromArgs", () => {
  it("#given a filename containing edge spaces #when extracted #then preserves the native target", () => {
    expect(readPathFromArgs({ filePath: " report.txt " })).toBe(" report.txt ")
  })

  describe("#given v1-style arguments", () => {
    it("#when filePath is present #then returns filePath", () => {
      // given
      const args = { filePath: "/tmp/notes.txt", content: "hello" }

      // when
      const result = readPathFromArgs(args)

      // then
      expect(result).toBe("/tmp/notes.txt")
    })
  })

  describe("#given v2-style arguments", () => {
    it("#when path is present #then returns path", () => {
      // given
      const args = { path: "src/index.ts", content: "hello" }

      // when
      const result = readPathFromArgs(args)

      // then
      expect(result).toBe("src/index.ts")
    })
  })

  describe("#given file_path fallback arguments", () => {
    it("#when only file_path is present #then returns file_path", () => {
      // given
      const args = { file_path: "legacy.txt" }

      // when
      const result = readPathFromArgs(args)

      // then
      expect(result).toBe("legacy.txt")
    })
  })

  describe("#given invalid path arguments", () => {
    it("#when the value is blank #then returns undefined", () => {
      // given / when / then
      expect(readPathFromArgs({ filePath: "   " })).toBeUndefined()
    })

    it("#when the value is not a string #then returns undefined", () => {
      // given / when / then
      expect(readPathFromArgs({ path: 42 })).toBeUndefined()
    })

    it("#when args is not a record #then returns undefined", () => {
      // given / when / then
      expect(readPathFromArgs(undefined)).toBeUndefined()
      expect(readPathFromArgs(["path"])).toBeUndefined()
      expect(readPathFromArgs("path")).toBeUndefined()
    })
  })
})

describe("resolveAbsolutePath", () => {
  it("#given a relative path #when resolved #then joins the cwd", () => {
    // given
    const cwd = "/workspace/project"

    // when
    const result = resolveAbsolutePath(cwd, "src/app.ts")

    // then
    expect(result).toBe(join(cwd, "src/app.ts"))
  })

  it("#given an absolute path #when resolved #then keeps it absolute", () => {
    // given / when / then
    expect(resolveAbsolutePath("/workspace", "/etc/hosts")).toBe("/etc/hosts")
  })
})

describe("canonicalizePath", () => {
  it.skipIf(!symlinks)("#given a symlink to a file #when canonicalized #then both aliases match", () => {
    // given
    const directory = createTempDir()
    try {
      const real = createFile(join(directory, "real.txt"))
      const alias = join(directory, "alias.txt")
      symlinkSync(real, alias)

      // when
      const canonicalReal = canonicalizePath(real)
      const canonicalAlias = canonicalizePath(alias)

      // then
      expect(canonicalAlias).toBe(canonicalReal)
      expect(canonicalReal).toBe(realpathSync.native(real))
    } finally {
      cleanupTempDir(directory)
    }
  })

  it.skipIf(!symlinks)("#given a missing file under a symlinked parent #when canonicalized #then aliases match", () => {
    // given
    const directory = createTempDir()
    try {
      const realDirectory = join(directory, "real")
      mkdirSync(realDirectory)
      const aliasDirectory = join(directory, "alias")
      symlinkSync(realDirectory, aliasDirectory)

      // when
      const canonicalReal = canonicalizePath(join(realDirectory, "missing.txt"))
      const canonicalAlias = canonicalizePath(join(aliasDirectory, "missing.txt"))

      // then
      expect(canonicalAlias).toBe(canonicalReal)
      expect(canonicalReal).toBe(join(realpathSync.native(realDirectory), "missing.txt"))
    } finally {
      cleanupTempDir(directory)
    }
  })

  it("#given a missing file under an existing directory #when canonicalized #then keeps the basename", () => {
    // given
    const directory = createTempDir()
    try {
      // when
      const result = canonicalizePath(join(directory, "nested", "missing.txt"))

      // then
      expect(result).toBe(join(realpathSync.native(directory), "nested", "missing.txt"))
    } finally {
      cleanupTempDir(directory)
    }
  })
})

describe("isExistingFile", () => {
  it("#given a file, a directory, and a missing path #then only the file is true", () => {
    // given
    const directory = createTempDir()
    try {
      const file = createFile(join(directory, "file.txt"))

      // when / then
      expect(isExistingFile(file)).toBe(true)
      expect(isExistingFile(directory)).toBe(false)
      expect(isExistingFile(join(directory, "missing.txt"))).toBe(false)
    } finally {
      cleanupTempDir(directory)
    }
  })
})
