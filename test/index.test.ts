import { describe, expect, it } from "bun:test"
import pluginModule, { id, server, setup } from "../src/index"

describe("plugin module shape", () => {
  describe("#given the dual-version entry", () => {
    it("#when inspected #then v1 server and v2 setup exports are present", () => {
      // given / when / then
      expect(id).toBe("o3p.tool.write-existing-file-guard")
      expect(server).toBeFunction()
      expect(setup).toBeFunction()
    })

    it("#when the default export is inspected #then it carries id, server, and setup", () => {
      // given / when / then
      expect(pluginModule.id).toBe(id)
      expect(pluginModule.server).toBe(server)
      expect(pluginModule.setup).toBe(setup)
    })
  })
})
