import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { cors } from "hono/cors"
import { readFileSync, existsSync } from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"

// Simple color codes
const R = "\x1b[31m" // red - errors
const G = "\x1b[32m" // green - success
const Y = "\x1b[33m" // yellow - warnings
const B = "\x1b[36m" // cyan - info
const X = "\x1b[0m" // reset

const log = {
  info: (msg: string, ...args: any[]) => console.log(`${B}${msg}${X}`, ...args),
  ok: (msg: string, ...args: any[]) => console.log(`${G}${msg}${X}`, ...args),
  warn: (msg: string, ...args: any[]) => console.log(`${Y}${msg}${X}`, ...args),
  err: (msg: string, ...args: any[]) => console.log(`${R}${msg}${X}`, ...args),
  req: (msg: string, ...args: any[]) => console.log(`${B}[REQ]${X}`, msg, ...args),
  res: (msg: string, ...args: any[]) => console.log(`${G}[RES]${X}`, msg, ...args),
}

const app = new Hono()

const dataDir = process.env.OPENCODE_DATA || path.join(os.homedir(), "AppData", "Roaming", "opencode")
const authFile = path.join(dataDir, "auth.json")
// Auth file locations loaded silently

const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const xdgAuthFile = path.join(xdgData, "opencode", "auth.json")

function loadAuth() {
  try {
    if (existsSync(authFile)) {
      const data = JSON.parse(readFileSync(authFile, "utf-8"))
      log.ok(`Auth loaded from file: ${Object.keys(data).join(", ")}`)
      return data
    }
    if (existsSync(xdgAuthFile)) {
      const data = JSON.parse(readFileSync(xdgAuthFile, "utf-8"))
      log.ok(`Auth loaded from XDG: ${Object.keys(data).join(", ")}`)
      return data
    }
  } catch (e) {
    console.error(`Failed to load auth: ${e}`)
  }
  return {}
}

let allAuth = loadAuth()
log.info(`Initial auth keys: ${Object.keys(allAuth).join(", ")}`)

setInterval(() => {
  allAuth = loadAuth()
}, 30000)

app.use(cors())

const ALLOWED_MODELS = ["gpt-4o", "gpt-4.1", "gpt-5-mini", "gpt-4o-mini"]

function isAllowedModel(model: string) {
  if (!model) return false
  // Allow exact match or prefix match (gpt-4o matches gpt-4o-2024-11-20)
  return ALLOWED_MODELS.some((allowed) => model === allowed || model.startsWith(allowed + "-"))
}

// === HEALTH ===
app.get("/health", async (c) => {
  return c.json({ status: "ok", service: "copilot-server" })
})

// === MODELS ===
app.get("/v1/models", async (c) => {
  const reqId = crypto.randomUUID()
  const stored = allAuth["github-copilot"]
  const token = stored?.access

  console.log(`[${reqId}] GET /v1/models, token: ${token?.slice(0, 20)}...`)

  if (!token) {
    return c.json({ error: { message: "No auth configured", code: 401 } }, 401)
  }

  const base = stored?.enterpriseUrl
    ? `https://copilot-api.${stored.enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
    : "https://api.githubcopilot.com"

  try {
    const response = await fetch(`${base}/models`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "opencode-copilot-server/1.0",
      },
    })
    const data = await response.json()
    return c.json(data)
  } catch (e) {
    return c.json({ error: { message: String(e) } }, 500)
  }
})

// === CHAT COMPLETIONS ===
app.post("/v1/chat/completions", async (c) => {
  const reqId = crypto.randomUUID().slice(0, 8)

  const body = await c.req.json().catch(() => ({}))
  const model = (body.model || "").trim()

  log.req(`${reqId} POST /v1/chat/completions model=${model}`)

  const stored = allAuth["github-copilot"]
  let token = stored?.access

  if (!token) {
    log.err(`${reqId} No stored token found`)
    return c.json({ error: { message: "No auth configured", code: 401 } }, 401)
  }

  log.info(`${reqId} messages=${body.messages?.length || 0} tools=${body.tools?.length || 0} stream=${body.stream || false}`)
  const reqBodyStr = JSON.stringify(body, null, 2)
  log.info(`${reqId} request (${reqBodyStr.length} bytes):`)
  log.info("\n" + reqBodyStr)

  if (!isAllowedModel(model)) {
    log.err(`${reqId} Model not allowed: ${model}`)
    return c.json(
      {
        error: {
          message: `Model not allowed. Allowed: ${ALLOWED_MODELS.join(", ")}`,
          type: "invalid_model",
          code: 400,
        },
      },
      400,
    )
  }

  const base = stored?.enterpriseUrl
    ? `https://copilot-api.${stored.enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
    : "https://api.githubcopilot.com"

  log.info(`${reqId} proxying to: ${base}/chat/completions`)

  if (body.response_format?.type === "json_object" && body.messages?.length > 0) {
    const hasJsonKeyword = body.messages.some((m: any) =>
      JSON.stringify(m.content || "").toLowerCase().includes("json"),
    )
    if (!hasJsonKeyword) {
      body.messages = [{ role: "system", content: "Respond with valid JSON." }, ...body.messages]
      log.info(`${reqId} Added JSON system message for json_object response_format`)
    }
  }

  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "opencode-copilot-server/1.0",
      },
      body: JSON.stringify(body),
    })

    log.info(`${reqId} upstream status: ${response.status}`)

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      const data = text ? JSON.parse(text) : {}
      log.err(`${reqId} upstream failed: ${response.status}`, text.slice(0, 500))
      return c.json({ error: data, status: response.status })
    }

    if (body.stream) {
      c.header("Content-Type", "text/event-stream")
      c.header("Cache-Control", "no-cache")
      c.header("Connection", "keep-alive")

      const reader = response.body!.getReader()
      let chunkCount = 0
      const stream = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read()
          if (done) {
            log.info(`${reqId} stream complete (${chunkCount} chunks)`)
            controller.close()
            return
          }
          chunkCount++
          controller.enqueue(value)
        },
        cancel() {
          reader.releaseLock()
        },
      })

      return c.body(stream)
    }

    const data = await response.json()
    log.res(`${reqId} response:\n` + JSON.stringify(data, null, 2))
    return c.json(data)
  } catch (e: any) {
    log.err(`${reqId} fetch error: ${e?.message || e}`)
    log.err(`${reqId} stack: ${e?.stack || "none"}`)
    return c.json({ error: { message: e?.message || String(e) } }, 500)
  }
})

// === RESPONSES API ===
function cleanNullValues(obj: any): any {
  if (obj === null) return undefined
  if (Array.isArray(obj)) return obj.map(cleanNullValues)
  if (typeof obj === "object" && obj !== null) {
    const result: any = {}
    for (const key of Object.keys(obj)) {
      result[key] = cleanNullValues(obj[key])
    }
    return result
  }
  return obj
}

app.post("/v1/responses", async (c) => {
  const reqId = crypto.randomUUID().slice(0, 8)

  const body = await c.req.json().catch(() => ({}))
  const model = (body.model || "").trim()

  log.req(`${reqId} POST /v1/responses model=${model}`)

  const stored = allAuth["github-copilot"]
  let token = stored?.access

  if (!token) {
    log.err(`${reqId} No stored token`)
    return c.json({ error: { message: "No auth configured", code: 401 } }, 401)
  }

  log.info(`${reqId} request:\n` + JSON.stringify(body, null, 2))

  if (!isAllowedModel(model)) {
    log.err(`${reqId} Model not allowed: ${model}`)
    return c.json(
      {
        error: {
          message: `Model not allowed. Allowed: ${ALLOWED_MODELS.join(", ")}`,
          type: "invalid_model",
          code: 400,
        },
      },
      400,
    )
  }

  const base = stored?.enterpriseUrl
    ? `https://copilot-api.${stored.enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
    : "https://api.githubcopilot.com"

  try {
    const response = await fetch(`${base}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "opencode-copilot-server/1.0",
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()
    log.res(`${reqId} response:\n` + JSON.stringify(data, null, 2))

    const usage = data.usage || data.response?.usage
    if (usage?.output_tokens_details?.reasoning_tokens) {
      log.info(`${reqId} reasoning_tokens: ${usage.output_tokens_details.reasoning_tokens}`)
    }

    const cleaned = cleanNullValues(data)
    return c.json(cleaned)
  } catch (e: any) {
    log.err(`${reqId} error: ${e?.message || e}`)
    return c.json({ error: { message: e?.message || String(e) } }, 500)
  }
})

// === COMPLETIONS ===
app.post("/v1/completions", async (c) => {
  const reqId = crypto.randomUUID().slice(0, 8)

  const body = await c.req.json().catch(() => ({}))
  const model = (body.model || "").trim()

  log.req(`${reqId} POST /v1/completions model=${model}`)

  const stored = allAuth["github-copilot"]
  let token = stored?.access

  if (!token) {
    log.err(`${reqId} No stored token`)
    return c.json({ error: { message: "No auth configured", code: 401 } }, 401)
  }

  log.info(`${reqId} request:\n` + JSON.stringify(body, null, 2))

  if (!isAllowedModel(model)) {
    log.err(`${reqId} Model not allowed: ${model}`)
    return c.json(
      {
        error: {
          message: `Model not allowed. Allowed: ${ALLOWED_MODELS.join(", ")}`,
          type: "invalid_model",
          code: 400,
        },
      },
      400,
    )
  }

  const base = stored?.enterpriseUrl
    ? `https://copilot-api.${stored.enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
    : "https://api.githubcopilot.com"

  try {
    const response = await fetch(`${base}/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "opencode-copilot-server/1.0",
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()
    log.res(`${reqId} response:\n` + JSON.stringify(data, null, 2))
    return c.json(data)
  } catch (e: any) {
    log.err(`${reqId} error: ${e?.message || e}`)
    return c.json({ error: { message: e?.message || String(e) } }, 500)
  }
})

const port = parseInt(process.env.PORT || "4096")
console.log(`Starting copilot server on port ${port}...`)

serve({
  fetch: app.fetch,
  port,
})

console.log(`Copilot server listening on http://127.0.0.1:${port}`)
