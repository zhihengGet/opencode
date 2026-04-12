import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Log } from "../../util/log"
import { Auth } from "../../auth"
import { lazy } from "../../util/lazy"
import { CopilotModels } from "../../plugin/github-copilot/models"
import { Installation } from "../../installation"

const log = Log.create({ service: "server.copilot" })

const base = (enterpriseUrl?: string) =>
  enterpriseUrl
    ? `https://copilot-api.${enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
    : "https://api.githubcopilot.com"

const MODEL_RESPONSE = z.object({
  id: z.string(),
  object: z.literal("model"),
  created: z.number(),
  owned_by: z.string(),
})

const MODEL_LIST = z.object({
  object: z.literal("list"),
  data: z.array(MODEL_RESPONSE),
})

const CHAT_COMPLETION = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number(),
      message: z.object({
        role: z.literal("assistant"),
        content: z.string(),
      }),
      finish_reason: z.string(),
    }),
  ),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
})

const COMPLETION = z.object({
  id: z.string(),
  object: z.literal("text_completion"),
  created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      text: z.string(),
      index: z.number(),
      finish_reason: z.string(),
    }),
  ),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
})

const DEVICE_AUTH = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  expires_in: z.number(),
  interval: z.number(),
})

const TOKEN_RESPONSE = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
})

export const CopilotServerRoutes = lazy(() => {
  const app = new Hono()

  app.get("/health", async (c) => {
    const reqId = crypto.randomUUID()
    console.log(`[${reqId}] GET /health`)
    return c.json({ status: "ok", service: "copilot-server" })
  })

  app.get(
    "/models",
    describeRoute({
      summary: "List models",
      description: "Get a list of available models.",
      operationId: "copilot.models",
      responses: {
        200: {
          description: "List of models",
          content: {
            "application/json": {
              schema: resolver(MODEL_LIST),
            },
          },
        },
      },
    }),
    async (c) => {
      const start = Date.now()
      const reqId = crypto.randomUUID()
      const authHeader = c.req.header("Authorization")

      console.log(`[${reqId}] GET /models, auth: ${authHeader ? "present" : "missing"}`)

      if (!authHeader?.startsWith("Bearer ")) {
        console.error(`[${reqId}] ERROR: missing auth header`)
        return c.text("Unauthorized", 401)
      }

      const token = authHeader.slice(7)
      const allAuth = await Auth.all()
      const copilotAuth = Object.entries(allAuth).find(([key]) => key.includes("github-copilot"))?.[1]

      if (!copilotAuth || copilotAuth.type !== "oauth") {
        console.error(`[${reqId}] ERROR: no copilot auth found, keys: ${Object.keys(allAuth)}`)
        return c.text("Unauthorized", 401)
      }

      try {
        const models = await CopilotModels.get(
          base(copilotAuth.enterpriseUrl),
          { Authorization: `Bearer ${token}` },
          {},
        )

        const result = {
          object: "list",
          data: Object.values(models).map((m) => ({
            id: m.id,
            object: "model",
            created: 2024,
            owned_by: "github",
          })),
        }

        const duration = Date.now() - start
        console.log(`[${reqId}] OK: ${result.data.length} models, ${duration}ms`)
        return c.json(result)
      } catch (e) {
        const duration = Date.now() - start
        console.error(`[${reqId}] ERROR: ${String(e)}, ${duration}ms`)
        return c.text("Internal Server Error", 500)
      }
    },
  )

  app.post(
    "/chat/completions",
    describeRoute({
      summary: "Create chat completion",
      description: "Create a chat completion for GitHub Copilot.",
      operationId: "copilot.chat.completions",
      responses: {
        200: {
          description: "Chat completion response",
          content: {
            "application/json": {
              schema: resolver(CHAT_COMPLETION),
            },
          },
        },
      },
    }),
    async (c) => {
      const start = Date.now()
      const reqId = crypto.randomUUID()
      const authHeader = c.req.header("Authorization")

      console.log(`[${reqId}] POST /chat/completions, auth: ${authHeader ? "present" : "missing"}`)

      if (!authHeader?.startsWith("Bearer ")) {
        console.error(`[${reqId}] ERROR: missing auth header`)
        return c.text("Unauthorized", 401)
      }

      const token = authHeader.slice(7)
      const allAuth = await Auth.all()
      const copilotAuth = Object.entries(allAuth).find(([key]) => key.includes("github-copilot"))?.[1]

      if (!copilotAuth || copilotAuth.type !== "oauth") {
        console.error(`[${reqId}] ERROR: no copilot auth found`)
        return c.text("Unauthorized", 401)
      }

      const body = await c.req.json().catch(() => ({}))
      console.log(`[${reqId}] body: model=${body.model}, messages=${body.messages?.length}, hasTools=${!!body.tools}`)

      try {
        const response = await fetch(`${base(copilotAuth.enterpriseUrl)}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": `opencode/${Installation.VERSION}`,
          },
          body: JSON.stringify(body),
        })

        const data = await response.json()
        const duration = Date.now() - start

        if (!response.ok) {
          console.error(`[${reqId}] ERROR upstream: ${response.status}, ${JSON.stringify(data).slice(0, 500)}`)
          return c.json({ error: data, status: response.status })
        }

        const content = data.choices?.[0]?.message?.content || ""
        console.log(`[${reqId}] OK: ${data.model}, content length: ${content.length}, ${duration}ms`)

        return c.json(data)
      } catch (e) {
        const duration = Date.now() - start
        console.error(`[${reqId}] ERROR: ${String(e)}, ${duration}ms`)
        return c.text("Internal Server Error", 500)
      }
    },
  )

  app.post(
    "/completions",
    describeRoute({
      summary: "Create completion",
      description: "Create a text completion for GitHub Copilot.",
      operationId: "copilot.completions",
      responses: {
        200: {
          description: "Completion response",
          content: {
            "application/json": {
              schema: resolver(COMPLETION),
            },
          },
        },
      },
    }),
    async (c) => {
      const start = Date.now()
      const reqId = crypto.randomUUID()
      const authHeader = c.req.header("Authorization")

      console.log(`[${reqId}] POST /completions, auth: ${authHeader ? "present" : "missing"}`)

      if (!authHeader?.startsWith("Bearer ")) {
        console.error(`[${reqId}] ERROR: missing auth header`)
        return c.text("Unauthorized", 401)
      }

      const token = authHeader.slice(7)
      const allAuth = await Auth.all()
      const copilotAuth = Object.entries(allAuth).find(([key]) => key.includes("github-copilot"))?.[1]

      if (!copilotAuth || copilotAuth.type !== "oauth") {
        console.error(`[${reqId}] ERROR: no copilot auth found`)
        return c.text("Unauthorized", 401)
      }

      const body = await c.req.json().catch(() => ({}))
      console.log(`[${reqId}] body: model=${body.model}, prompt length=${String(body.prompt).length}`)

      try {
        const response = await fetch(`${base(copilotAuth.enterpriseUrl)}/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": `opencode/${Installation.VERSION}`,
          },
          body: JSON.stringify(body),
        })

        const data = await response.json()
        const duration = Date.now() - start

        const text = data.choices?.[0]?.text || ""
        console.log(`[${reqId}] OK: ${data.model}, text length: ${text.length}, ${duration}ms`)

        return c.json(data)
      } catch (e) {
        const duration = Date.now() - start
        console.error(`[${reqId}] ERROR: ${String(e)}, ${duration}ms`)
        return c.text("Internal Server Error", 500)
      }
    },
  )

  app.post(
    "/oauth/device/authorize",
    describeRoute({
      summary: "Initiate device authorization",
      description: "Start the OAuth device authorization flow for GitHub Copilot.",
      operationId: "copilot.oauth.device.authorize",
      responses: {
        200: {
          description: "Device authorization response",
          content: {
            "application/json": {
              schema: resolver(DEVICE_AUTH),
            },
          },
        },
      },
    }),
    async (c) => {
      const reqId = crypto.randomUUID()
      const body = await c.req.json().catch(() => ({}))
      const DEVICE_CLIENT_ID = (body as { client_id?: string }).client_id || "Ov23li8tweQw6odWQebz"

      console.log(`[${reqId}] POST /oauth/device/authorize, client_id: ${DEVICE_CLIENT_ID}`)

      try {
        const response = await fetch("https://github.com/login/device/code", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": `opencode/${Installation.VERSION}`,
          },
          body: JSON.stringify({
            client_id: DEVICE_CLIENT_ID,
            scope: "read:user",
          }),
        })

        const data = await response.json()
        console.log(`[${reqId}] OK: ${response.status}`)
        return c.json(data)
      } catch (e) {
        console.error(`[${reqId}] ERROR: ${String(e)}`)
        return c.text("Internal Server Error", 500)
      }
    },
  )

  app.post(
    "/oauth/device/token",
    describeRoute({
      summary: "Poll for device token",
      description: "Poll for access token during device authorization.",
      operationId: "copilot.oauth.device.token",
      responses: {
        200: {
          description: "Token response",
          content: {
            "application/json": {
              schema: resolver(TOKEN_RESPONSE),
            },
          },
        },
      },
    }),
    async (c) => {
      const reqId = crypto.randomUUID()
      const body = await c.req.json().catch(() => ({}))
      const { device_code, grant_type, client_id } = body as {
        device_code?: string
        grant_type?: string
        client_id?: string
      }
      const DEVICE_CLIENT_ID = client_id || "Ov23li8tweQw6odWQebz"

      console.log(`[${reqId}] POST /oauth/device/token, hasDeviceCode: ${!!device_code}`)

      if (!device_code) {
        console.error(`[${reqId}] ERROR: device_code required`)
        return c.json({ error: "device_code required" })
      }

      try {
        const response = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": `opencode/${Installation.VERSION}`,
          },
          body: JSON.stringify({
            client_id: DEVICE_CLIENT_ID,
            device_code,
            grant_type: grant_type || "urn:ietf:params:oauth:grant-type:device_code",
          }),
        })

        const data = await response.json()
        console.log(`[${reqId}] OK: ${response.status}, hasToken: ${!!data.access_token}`)
        return c.json(data)
      } catch (e) {
        console.error(`[${reqId}] ERROR: ${String(e)}`)
        return c.text("Internal Server Error", 500)
      }
    },
  )

  app.all("*", async (c) => {
    console.log(`>> 404 NOT FOUND: ${c.req.method} ${c.req.path}`)
    return c.json({ error: "Not found" }, 404)
  })

  return app
})
