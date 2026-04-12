import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "http"
import { createOpenaiCompatible } from "../../src/provider/sdk/copilot"

const FREE_MODELS = ["gpt-4.1", "gpt-4o", "gpt-4o-mini"] as const

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description: "Get weather for a location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
        },
        required: ["location"],
      },
    },
  },
]

describe("Copilot Server Integration", () => {
  let server: ReturnType<typeof createHttpServer>
  let baseURL: string

  beforeAll(() => {
    return new Promise<void>((resolve) => {
      server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
        const url = req.url ?? ""
        const method = req.method ?? ""

        if (method === "GET" && url === "/v1/models") {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(
            JSON.stringify({
              object: "list",
              data: [
                { id: "gpt-4.1", object: "model", created: 2024, owned_by: "github" },
                { id: "gpt-4o", object: "model", created: 2024, owned_by: "github" },
                { id: "gpt-4o-mini", object: "model", created: 2024, owned_by: "github" },
              ],
            }),
          )
          return
        }

        if (method === "POST" && (url === "/v1/chat/completions" || url === "/chat/completions")) {
          let body = ""
          req.on("data", (chunk) => {
            body += chunk
          })
          req.on("end", () => {
            const data = JSON.parse(body)
            const hasTools = data.tools || data.functions

            if (hasTools) {
              res.writeHead(200, { "Content-Type": "application/json" })
              res.end(
                JSON.stringify({
                  id: "chatcmpl-test",
                  object: "chat.completion",
                  created: Date.now(),
                  model: data.model,
                  choices: [
                    {
                      index: 0,
                      message: {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                          {
                            id: "call_123",
                            type: "function",
                            function: { name: "get_weather", arguments: JSON.stringify({ location: "NYC" }) },
                          },
                        ],
                      },
                      finish_reason: "tool_calls",
                    },
                  ],
                  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                }),
              )
              return
            }

            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(
              JSON.stringify({
                id: "chatcmpl-test",
                object: "chat.completion",
                created: Date.now(),
                model: data.model,
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: `hello from ${data.model}` },
                    finish_reason: "stop",
                  },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
              }),
            )
          })
          return
        }

        if (method === "POST" && url === "/v1/completions") {
          let body = ""
          req.on("data", (chunk) => {
            body += chunk
          })
          req.on("end", () => {
            const data = JSON.parse(body)
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(
              JSON.stringify({
                id: "cmpl-test",
                object: "text_completion",
                created: Date.now(),
                model: data.model,
                choices: [
                  {
                    text: `hello from ${data.model}`,
                    index: 0,
                    finish_reason: "stop",
                  },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
              }),
            )
          })
          return
        }

        res.writeHead(404)
        res.end()
      })

      server.listen(0, () => {
        const addr = server.address()
        if (addr && typeof addr !== "string") {
          baseURL = `http://127.0.0.1:${addr.port}`
          resolve()
        }
      })
    })
  })

  afterAll(() => {
    server.close()
  })

  test("GET /v1/models returns model list", async () => {
    const response = await fetch(`${baseURL}/v1/models`)

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.object).toBe("list")
    expect(data.data).toHaveLength(3)
    expect(data.data[0].id).toBe("gpt-4.1")
  })

  test("POST /v1/chat/completions returns model in response", async () => {
    const response = await fetch(`${baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      }),
    })

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.model).toBe("gpt-4o")
    expect(data.choices[0].message.content).toBe("hello from gpt-4o")
  })

  test("ai-sdk works with gpt-4.1, gpt-4o, gpt-4o-mini", async () => {
    const provider = createOpenaiCompatible({
      baseURL,
      apiKey: "test-token",
    })

    for (const modelId of FREE_MODELS) {
      const model = provider.chat(modelId)

      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Say 'hello' in one word." }] }],
      })

      const content = result.content
      const text = content?.[0]?.type === "text" ? content[0].text : undefined
      console.log(`model: ${modelId}, text: ${text}`)
      expect(text).toBe(`hello from ${modelId}`)
    }
  })

  test("tool calling works", async () => {
    const provider = createOpenaiCompatible({
      baseURL,
      apiKey: "test-token",
    })

    const model = provider.chat("gpt-4o")

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "What's the weather in NYC?" }] }],
      tools: TOOLS as any,
    })

    const content = result.content
    const hasToolCall = content?.some((c) => c.type === "tool-call")
    console.log(`tool calling result:`, JSON.stringify(result))
    expect(hasToolCall).toBe(true)
  })

  test("reasoning with gpt-4.1", async () => {
    const provider = createOpenaiCompatible({
      baseURL,
      apiKey: "test-token",
    })

    const model = provider.chat("gpt-4.1")

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Think carefully about 2+2" }] }],
    })

    const content = result.content
    const text = content?.[0]?.type === "text" ? content[0].text : undefined
    console.log(`gpt-4.1 reasoning result: ${text}`)
    expect(text).toBeDefined()
  })
})
