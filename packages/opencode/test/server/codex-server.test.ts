import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import os from "os"
import path from "path"
import { createOpenaiCompatible } from "../../src/provider/sdk/copilot"

describe("Codex Server + AI SDK", () => {
  const port = 43102
  const host = `http://127.0.0.1:${port}`
  const baseURL = `${host}/v1`

  const dataDir =
    process.env.OPENCODE_DATA || path.join(os.homedir(), "AppData", "Roaming", "opencode")
  const local = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  const authFile = path.join(dataDir, "auth.json")
  const xdgAuthFile = path.join(local, "opencode", "auth.json")
  const authPath = existsSync(authFile) ? authFile : existsSync(xdgAuthFile) ? xdgAuthFile : authFile

  let dir = ""
  let child: ReturnType<typeof Bun.spawn>

  let enabled = false

  function canRunWithStoredAuth() {
    try {
      if (!existsSync(authPath)) return false
      const store = JSON.parse(readFileSync(authPath, "utf-8")) as Record<string, unknown>
      const item = store.openai as
        | {
            type?: string
            access?: string
            refresh?: string
            expires?: number
          }
        | undefined

      if (!item || item.type !== "oauth") return false
      if (!item.access) return false
      if (typeof item.expires === "number" && item.expires <= Date.now() && !item.refresh) return false

      // token can be used directly or refreshed using refresh token
      return true
    } catch {
      return false
    }
  }

  beforeAll(() => {
    enabled = canRunWithStoredAuth()
    if (!enabled) {
      return
    }

    dir = dataDir

    return new Promise<void>((resolve, reject) => {
      child = Bun.spawn({
        cmd: ["bun", "run", "src/codex-server.ts"],
        cwd: process.cwd(),
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        env: {
          ...process.env,
          PORT: String(port),
          OPENCODE_DATA: dir,
        },
      })

      const wait = async () => {
        for (let i = 0; i < 40; i++) {
          try {
            const res = await fetch(`${host}/health`)
            if (res.status === 200) return
          } catch {}
          await new Promise((done) => setTimeout(done, 100))
        }
        throw new Error("codex server failed to start")
      }

      wait().then(() => resolve()).catch(reject)
    })
  })

  afterAll(() => {
    if (child) child.kill()
  })

  if (!enabled) {
    test.skip("ai sdk can call /v1/chat/completions (requires local opencode openai auth)", () => {})
    return
  }

  test("ai sdk can call /v1/chat/completions", async () => {
    const provider = createOpenaiCompatible({ baseURL, apiKey: "test" })

    const model = provider.chat("gpt-5.3-codex-spark")
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "say hello" }] }],
    })

    const text = result.content?.[0]?.type === "text" ? result.content[0].text : undefined
    expect(typeof text).toBe("string")
    expect(text?.length).toBeGreaterThan(0)
  })
})
