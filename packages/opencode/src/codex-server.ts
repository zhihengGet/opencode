import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { cors } from "hono/cors"
import crypto from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "os"
import path from "path"

const R = "\x1b[31m"
const G = "\x1b[32m"
const B = "\x1b[36m"
const X = "\x1b[0m"

const log = {
  info: (msg: string, ...args: unknown[]) => console.log(`${B}${msg}${X}`, ...args),
  err: (msg: string, ...args: unknown[]) => console.log(`${R}${msg}${X}`, ...args),
  res: (msg: string, ...args: unknown[]) => console.log(`${G}${msg}${X}`, ...args),
}

const app = new Hono()

const root = process.env.OPENCODE_DATA || path.join(os.homedir(), "AppData", "Roaming", "opencode")
const file = path.join(root, "auth.json")
const local = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const fallback = path.join(local, "opencode", "auth.json")

const clientId = "app_EMoamEEZ73f0CkXaXp7hrann"
const issuer = "https://auth.openai.com"
const tokenUrl = `${issuer}/oauth/token`
const endpoint = process.env.CODEX_API_ENDPOINT ?? "https://chatgpt.com/backend-api/codex/responses"

const models = [
  "gpt-5.3-codex-spark",
] as const

type Auth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

type Store = Record<string, unknown>

type Claims = {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  ["https://api.openai.com/auth"]?: { chatgpt_account_id?: string }
}

type Tokens = {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

function authPath() {
  if (existsSync(file)) return file
  if (existsSync(fallback)) return fallback
  return file
}

function readAuth() {
  try {
    const path = authPath()
    if (!existsSync(path)) return {} as Store

    const data = JSON.parse(readFileSync(path, "utf-8")) as Store
    return data
  } catch (err) {
    console.error(`Failed to load auth: ${err}`)
    return {} as Store
  }
}

function writeAuth(data: Store) {
  const file = authPath()
  const dir = file.substring(0, file.lastIndexOf(path.sep))

  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2), "utf-8")
}

function isAuth(input: unknown): input is Auth {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as Auth).type === "oauth" &&
    typeof (input as Auth).refresh === "string" &&
    typeof (input as Auth).access === "string" &&
    typeof (input as Auth).expires === "number"
  )
}

function modelName(input: unknown) {
  return typeof input === "string" ? input.trim() : ""
}

function allowed(model: string) {
  return models.some((it) => model === it || model.startsWith(`${it}-`))
}

function parseClaims(token: string) {
  const bits = token.split(".")
  if (bits.length !== 3) return

  try {
    return JSON.parse(Buffer.from(bits[1], "base64url").toString()) as Claims
  } catch {
    return
  }
}

function accountIdFromClaims(claims: Claims | undefined) {
  return (
    claims?.chatgpt_account_id ||
    claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims?.organizations?.[0]?.id
  )
}

function accountIdFromTokens(tokens: Tokens) {
  if (tokens.id_token) {
    const parsed = parseClaims(tokens.id_token)
    const id = accountIdFromClaims(parsed)
    if (id) return id
  }

  return accountIdFromClaims(parseClaims(tokens.access_token))
}

async function refreshAuth(refresh: string) {
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
    }).toString(),
  })

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`)
  }

  return (await res.json()) as Tokens
}

async function getAuthToken() {
  const store = readAuth()
  const value = store.openai

  if (!isAuth(value)) return

  if (value.expires > Date.now()) return value
  if (!value.refresh) {
    log.err("OpenAI auth expired and no refresh token is available")
    return
  }

  const next = await refreshAuth(value.refresh)
  const accountId = accountIdFromTokens(next) || value.accountId
  const auth: Auth = {
    type: "oauth",
    refresh: next.refresh_token || value.refresh,
    access: next.access_token,
    expires: Date.now() + ((next.expires_in ?? 3600) * 1000),
    ...(accountId ? { accountId } : {}),
  }

  store.openai = auth
  writeAuth(store)
  return auth
}

function cleanNullValues(input: unknown): unknown {
  if (input === null) return undefined
  if (Array.isArray(input)) return input.map(cleanNullValues)
  if (typeof input === "object" && input !== null) {
    const output = {} as Record<string, unknown>
    for (const [key, value] of Object.entries(input)) {
      output[key] = cleanNullValues(value)
    }
    return output
  }

  return input
}

async function parseBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

function modelError() {
  return {
    message: `Model not allowed. Allowed: ${models.join(", ")}`,
    type: "invalid_model",
    code: 400,
  }
}

function authMissing() {
  return { error: { message: "No auth configured", code: 401 } }
}

app.use(cors())

app.get("/health", async (c) => {
  return c.json({ status: "ok", service: "codex-server" })
})

app.get("/v1/models", async (c) => {
  const token = await getAuthToken()
  if (!token) {
    return c.json(authMissing(), 401)
  }

  return c.json({
    object: "list",
    data: models.map((id) => ({ id, object: "model", created: 2025, owned_by: "openai" })),
  })
})

app.post("/v1/chat/completions", async (c) => {
  const id = crypto.randomUUID().slice(0, 8)
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const model = modelName(body.model)

  log.info(`\n[${id}] POST /v1/chat/completions model=${model}`)

  if (!allowed(model)) {
    log.err(`[${id}] model not allowed: ${model}`)
    return c.json({ error: modelError() }, 400)
  }

  const auth = await getAuthToken()
  if (!auth) {
    log.err(`[${id}] no auth configured`)
    return c.json(authMissing(), 401)
  }

  const format = body.response_format
  if (
    typeof format === "object" &&
    format !== null &&
    (format as { type?: unknown }).type === "json_object" &&
    Array.isArray(body.messages)
  ) {
    const hasJson = body.messages.some((item: unknown) => {
      if (typeof item !== "object" || item === null) return false
      const content = (item as Record<string, unknown>).content
      return typeof content === "string" && content.toLowerCase().includes("json")
    })

    if (!hasJson) {
      body.messages = [{ role: "system", content: "Respond with valid JSON." }, ...body.messages]
    }
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access}`,
        "User-Agent": "opencode-codex-server/1.0",
        ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const data = await parseBody(response)
      log.err(`[${id}] upstream failed: ${response.status}`)
      return new Response(JSON.stringify({ error: data }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      })
    }

    const data = response.body
    if (body.stream === true && data) {
      const reader = data.getReader()
      let count = 0

      c.header("Content-Type", "text/event-stream")
      c.header("Cache-Control", "no-cache")
      c.header("Connection", "keep-alive")

      return c.body(
        new ReadableStream({
          async pull(controller) {
            const { done, value } = await reader.read()
            if (done) {
              log.res(`[${id}] stream complete (${count} chunks)`)
              controller.close()
              return
            }

            count += 1
            controller.enqueue(value)
          },
          cancel() {
            reader.releaseLock()
          },
        }),
      )
    }

    const dataJson = cleanNullValues(await parseBody(response))
    return c.json(dataJson)
  } catch (error) {
    log.err(`[${id}] fetch error: ${(error as Error).message || error}`)
    return c.json({ error: { message: (error as Error).message || String(error) } }, 500)
  }
})

app.post("/v1/responses", async (c) => {
  const id = crypto.randomUUID().slice(0, 8)
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const model = modelName(body.model)

  log.info(`\n[${id}] POST /v1/responses model=${model}`)

  if (!allowed(model)) {
    log.err(`[${id}] model not allowed: ${model}`)
    return c.json({ error: modelError() }, 400)
  }

  const auth = await getAuthToken()
  if (!auth) {
    log.err(`[${id}] no auth configured`)
    return c.json(authMissing(), 401)
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access}`,
        "User-Agent": "opencode-codex-server/1.0",
        ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
      },
      body: JSON.stringify(body),
    })

    const parsed = cleanNullValues(await parseBody(response))
    if (!response.ok) {
      log.err(`[${id}] upstream failed: ${response.status}`)
      return new Response(JSON.stringify({ error: parsed }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      })
    }

    const usage =
      typeof parsed === "object" && parsed !== null && "usage" in parsed
        ? (parsed as { usage?: { output_tokens_details?: { reasoning_tokens?: unknown } } }).usage
        : undefined
    const reasoning =
      typeof usage?.output_tokens_details === "object" && usage?.output_tokens_details !== null
        ? (usage.output_tokens_details as { reasoning_tokens?: unknown }).reasoning_tokens
        : undefined

    if (typeof reasoning === "number") {
      log.info(`[${id}] reasoning_tokens: ${reasoning}`)
    }

    return c.json(parsed)
  } catch (error) {
    log.err(`[${id}] error: ${(error as Error).message || error}`)
    return c.json({ error: { message: (error as Error).message || String(error) } }, 500)
  }
})

app.post("/v1/completions", async (c) => {
  const id = crypto.randomUUID().slice(0, 8)
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const model = modelName(body.model)

  log.info(`\n[${id}] POST /v1/completions model=${model}`)

  if (!allowed(model)) {
    log.err(`[${id}] model not allowed: ${model}`)
    return c.json({ error: modelError() }, 400)
  }

  const auth = await getAuthToken()
  if (!auth) {
    log.err(`[${id}] no auth configured`)
    return c.json(authMissing(), 401)
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access}`,
        "User-Agent": "opencode-codex-server/1.0",
        ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
      },
      body: JSON.stringify(body),
    })

    const parsed = cleanNullValues(await parseBody(response))
    if (!response.ok) {
      log.err(`[${id}] upstream failed: ${response.status}`)
      return new Response(JSON.stringify({ error: parsed }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      })
    }

    return c.json(parsed)
  } catch (error) {
    log.err(`[${id}] error: ${(error as Error).message || error}`)
    return c.json({ error: { message: (error as Error).message || String(error) } }, 500)
  }
})

const port = parseInt(process.env.PORT || "4097")
console.log(`Starting codex server on port ${port}...`)

serve({
  fetch: app.fetch,
  port,
})

console.log(`Codex server listening on http://127.0.0.1:${port}`)
