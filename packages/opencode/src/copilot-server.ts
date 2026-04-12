import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { cors } from "hono/cors"
import { readFileSync, existsSync } from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"

const app = new Hono()

const dataDir = process.env.OPENCODE_DATA || path.join(os.homedir(), "AppData", "Roaming", "opencode")
const authFile = path.join(dataDir, "auth.json")
console.log(`Looking for auth in: ${authFile}`)

const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const xdgAuthFile = path.join(xdgData, "opencode", "auth.json")
console.log(`Also checking: ${xdgAuthFile}`)

function loadAuth() {
  try {
    if (existsSync(authFile)) {
      const data = JSON.parse(readFileSync(authFile, "utf-8"))
      console.log(`Loaded auth from ${authFile}: ${Object.keys(data).join(", ")}`)
      return data
    }
    if (existsSync(xdgAuthFile)) {
      const data = JSON.parse(readFileSync(xdgAuthFile, "utf-8"))
      console.log(`Loaded auth from ${xdgAuthFile}: ${Object.keys(data).join(", ")}`)
      return data
    }
  } catch (e) {
    console.error(`Failed to load auth: ${e}`)
  }
  return {}
}

let allAuth = loadAuth()
console.log(`Initial auth keys: ${Object.keys(allAuth).join(", ")}`)

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
  const reqId = crypto.randomUUID()
  const authHeader = c.req.header("Authorization")

  console.log(`[${reqId}] POST /v1/chat/completions, auth: ${authHeader ? "provided but ignored" : "none"}`)

  // Always use stored token from opencode - ignore user authorization header
  const stored = allAuth["github-copilot"]
  let token = stored?.access

  if (!token) {
    return c.json({ error: { message: "No auth configured", code: 401 } }, 401)
  }

  const body = await c.req.json().catch(() => ({}))
  const model = body.model || ""

  if (!isAllowedModel(model)) {
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
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "opencode-copilot-server/1.0",
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()
    console.log(`[${reqId}] OK: ${response.status}`)
    return c.json(data)
  } catch (e) {
    return c.json({ error: { message: String(e) } }, 500)
  }
})

// === RESPONSES API ===
app.post("/v1/responses", async (c) => {
  const reqId = crypto.randomUUID()
  const authHeader = c.req.header("Authorization")

  console.log(`[${reqId}] POST /v1/responses, auth: ${authHeader ? "provided but ignored" : "none"}`)

  // Always use stored token - ignore user authorization
  const stored = allAuth["github-copilot"]
  let token = stored?.access

  if (!token) {
    return c.json({ error: { message: "No auth configured", code: 401 } }, 401)
  }

  const body = await c.req.json().catch(() => ({}))
  const model = body.model || ""

  if (!isAllowedModel(model)) {
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
    return c.json(data)
  } catch (e) {
    return c.json({ error: { message: String(e) } }, 500)
  }
})

// === COMPLETIONS ===
app.post("/v1/completions", async (c) => {
  const reqId = crypto.randomUUID()
  const authHeader = c.req.header("Authorization")

  console.log(`[${reqId}] POST /v1/completions, auth: ${authHeader ? "provided but ignored" : "none"}`)

  // Always use stored token - ignore user authorization
  const stored = allAuth["github-copilot"]
  let token = stored?.access

  if (!token) {
    return c.json({ error: { message: "No auth configured", code: 401 } }, 401)
  }

  const body = await c.req.json()
  const model = body.model || ""

  if (!isAllowedModel(model)) {
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

  const response = await fetch(`${base}/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  const data = await response.json()
  return c.json(data)
})

const port = parseInt(process.env.PORT || "4096")
console.log(`Starting copilot server on port ${port}...`)

serve({
  fetch: app.fetch,
  port,
})

console.log(`Copilot server listening on http://127.0.0.1:${port}`)
