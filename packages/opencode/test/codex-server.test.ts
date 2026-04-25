import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, streamText } from "ai"

const CODEX_SERVER_URL = process.env.CODEX_SERVER_URL || "http://127.0.0.1:4097"
const TEST_MODEL = "gpt-5.3-codex-spark"

describe("codex-server", () => {
  test("health endpoint returns ok", async () => {
    const res = await fetch(`${CODEX_SERVER_URL}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.service).toBe("codex-server")
  })

  test("models endpoint returns codex models", async () => {
    const res = await fetch(`${CODEX_SERVER_URL}/v1/models`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.object).toBe("list")
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBe(1)
    expect(body.data[0].id).toBe("gpt-5.3-codex-spark")
    expect(body.data[0]).toHaveProperty("id")
    expect(body.data[0]).toHaveProperty("object", "model")
    expect(body.data[0]).toHaveProperty("owned_by", "openai")
  })

  test("chat completions endpoint validates model", async () => {
    const res = await fetch(`${CODEX_SERVER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "invalid-model",
        messages: [{ role: "user", content: "hi" }],
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.error.type).toBe("invalid_model")
  })

  test("responses endpoint validates model", async () => {
    const res = await fetch(`${CODEX_SERVER_URL}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "invalid-model",
        input: "hi",
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.error.type).toBe("invalid_model")
  })
})

describe("codex-server with ai-sdk", () => {
  const provider = createOpenAICompatible({
    name: "codex-local",
    baseURL: `${CODEX_SERVER_URL}/v1`,
    apiKey: "dummy-key",
  })

  test("provider creates language model via call", () => {
    const model = provider(TEST_MODEL)
    expect(model).toBeDefined()
    expect(model.provider).toContain("codex-local")
  })

  test("provider creates language model via languageModel method", () => {
    const model = provider.languageModel(TEST_MODEL)
    expect(model).toBeDefined()
    expect(model.provider).toContain("codex-local")
  })
})
