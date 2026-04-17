import { OpenAIResponsesLanguageModel } from "@/provider/sdk/copilot/responses/openai-responses-language-model"
import { describe, test, expect, mock, beforeAll, afterAll } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { appendFileSync, existsSync, mkdirSync } from "fs"
import { dirname, join } from "path"

const LOG_FILE = join(process.cwd(), "test-output.log")

function logToFile(msg: string) {
  const timestamp = new Date().toISOString()
  try {
    appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`)
  } catch (e: any) {
    console.error("Failed to write log:", e.message)
  }
}

beforeAll(() => {
  logToFile("=== Test Suite Started ===")
})

afterAll(() => {
  logToFile("=== Test Suite Finished ===")
})

const originalConsoleLog = console.log
console.log = (...args: any[]) => {
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")
  originalConsoleLog(msg)
  logToFile(msg)
}

async function convertReadableStreamToArray<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader()
  const result: T[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result.push(value)
  }
  return result
}

const TEST_PROMPT: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }]

const RESPONSE_FIXTURES = {
  basicText: [
    `{"type":"response.created","response":{"id":"resp_123","created_at":1677652288,"model":"gpt-4.1"}}`,
    `{"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_123"}}`,
    `{"type":"response.output_text.delta","item_id":"msg_123","delta":"Hello"}`,
    `{"type":"response.output_text.delta","item_id":"msg_123","delta":" world"}`,
    `{"type":"response.output_text.delta","item_id":"msg_123","delta":"!"}`,
    `{"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_123"}}`,
    `{"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":15,"output_tokens_details":{}}}}`,
  ],

  withToolCall: [
    `{"type":"response.created","response":{"id":"resp_456","created_at":1677652288,"model":"gpt-4.1"}}`,
    `{"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_456"}}`,
    `{"type":"response.output_text.delta","item_id":"msg_456","delta":"I'll use the calculator."}`,
    `{"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_456"}}`,
    `{"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"call_123","call_id":"call_abc","name":"calculator","arguments":""}}`,
    `{"type":"response.function_call_arguments.delta","item_id":"call_abc","output_index":1,"delta":"{"}`,
    `{"type":"response.function_call_arguments.delta","item_id":"call_abc","output_index":1,"delta":"\\"code\\":\\"2 + 2\\""}`,
    `{"type":"response.function_call_arguments.delta","item_id":"call_abc","output_index":1,"delta":"}"}`,
    `{"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","id":"call_123","call_id":"call_abc","name":"calculator","arguments":"{\\"code\\":\\"2 + 2\\"","status":"completed"}}`,
    `{"type":"response.completed","response":{"usage":{"input_tokens":20,"output_tokens":35,"output_tokens_details":{"reasoning_tokens":0}}}}`,
  ],

  withCodeInterpreter: [
    `{"type":"response.created","response":{"id":"resp_789","created_at":1677652288,"model":"gpt-4.1"}}`,
    `{"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_789"}}`,
    `{"type":"response.output_text.delta","item_id":"msg_789","delta":"I'll run some Python code."}`,
    `{"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_789"}}`,
    `{"type":"response.output_item.added","output_index":1,"item":{"type":"code_interpreter_call","id":"code_123","container_id":"cont_abc","code":"print('Hello')","status":"in_progress"}}`,
    `{"type":"response.code_interpreter_call_code.done","item_id":"code_123","output_index":1,"code":"print('Hello')"}`,
    `{"type":"response.output_item.done","output_index":1,"item":{"type":"code_interpreter_call","id":"code_123","container_id":"cont_abc","code":"print('Hello')","outputs":[{"type":"logs","logs":"Hello\\n"}],"status":"completed"}}`,
    `{"type":"response.completed","response":{"usage":{"input_tokens":25,"output_tokens":45,"output_tokens_details":{"reasoning_tokens":0}}}}`,
  ],
}

function createModel(mockFetch: ReturnType<typeof mock>) {
  return new OpenAIResponsesLanguageModel("gpt-4.1", {
    provider: "test.responses",
    headers: () => ({}),
    url: () => "http://localhost:4096/responses",
    fetch: mockFetch as any,
  })
}

function createMockFetch(chunks: string[]) {
  return mock(async () => {
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          const data = chunk.replace(/^\{"type":"response.completed/, '{"type":"response.incomplete')
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
        }
        controller.close()
      },
    })
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
  })
}

describe("OpenAIResponsesLanguageModel", () => {
  describe("doGenerate", () => {
    test("should generate basic text", async () => {
      const mockFetch = mock(async () => {
        const json = {
          id: "resp_123",
          created_at: 1677652288,
          model: "gpt-4.1",
          output: [
            {
              type: "message",
              role: "assistant",
              id: "msg_abc",
              content: [{ type: "output_text", text: "Hello world!" }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 15 },
        }
        return new Response(JSON.stringify(json), { status: 200 })
      })

      const model = createModel(mockFetch)
      const result = await model.doGenerate({ prompt: TEST_PROMPT })

      expect(result.content).toEqual([
        { type: "text", text: "Hello world!", providerMetadata: { openai: { itemId: "msg_abc" } } },
      ])
      expect(result.finishReason.unified).toBe("stop")
      expect(result.usage.inputTokens.total).toBe(10)
    })

    test("should handle tool calls", async () => {
      const mockFetch = mock(async () => {
        const json = {
          id: "resp_456",
          created_at: 1677652288,
          model: "gpt-4.1",
          output: [
            { type: "message", role: "assistant", id: "msg_abc", content: [{ type: "output_text", text: "" }] },
            {
              type: "function_call",
              id: "call_123",
              call_id: "call_abc",
              name: "calculator",
              arguments: '{"code":"2 + 2"}',
            },
          ],
          usage: { input_tokens: 20, output_tokens: 35 },
        }
        return new Response(JSON.stringify(json), { status: 200 })
      })

      const model = createModel(mockFetch)
      const result = await model.doGenerate({ prompt: TEST_PROMPT })

      expect(result.content).toContainEqual({
        type: "tool-call",
        toolCallId: "call_abc",
        toolName: "calculator",
        input: '{"code":"2 + 2"}',
        providerMetadata: { openai: { itemId: "call_123" } },
      })
    })

    test("should convert null outputs to empty array", async () => {
      const mockFetch = mock(async () => {
        const json = {
          id: "resp_code",
          created_at: 1677652288,
          model: "gpt-4.1",
          output: [
            {
              type: "code_interpreter_call",
              id: "code_123",
              container_id: "cont_abc",
              code: "print('test')",
              outputs: null,
            },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        }
        return new Response(JSON.stringify(json), { status: 200 })
      })

      const model = createModel(mockFetch)
      const result = await model.doGenerate({ prompt: TEST_PROMPT })

      const toolResult = result.content.find((c) => c.type === "tool-result")
      expect(toolResult).toBeDefined()
      expect((toolResult as any).result.outputs).toEqual([])
    })
  })

  describe("doStream", () => {
    test("should create stream without error", async () => {
      console.log("DEBUG: Starting stream test")
      const mockFetch = createMockFetch(RESPONSE_FIXTURES.basicText)
      const model = createModel(mockFetch)

      const { stream } = await model.doStream({
        prompt: TEST_PROMPT,
        includeRawChunks: false,
      })

      console.log("DEBUG: Stream obtained, testing...")
      expect(stream).toBeDefined()
      console.log("DEBUG: Test passed!")
    })

    test("should return correct chunk sequence", async () => {
      const mockFetch = createMockFetch(RESPONSE_FIXTURES.basicText)
      const model = createModel(mockFetch)

      const { stream } = await model.doStream({
        prompt: TEST_PROMPT,
        includeRawChunks: false,
      })

      const reader = stream.getReader()
      let count = 0
      const allChunks: any[] = []
      while (true) {
        const result = await reader.read()
        if (result.done) break
        allChunks.push(result.value)
        count++
      }

      expect(count).toBe(8)
      expect(allChunks.map((c) => c.type)).toEqual([
        "stream-start",
        "response-metadata",
        "text-start",
        "text-delta",
        "text-delta",
        "text-delta",
        "text-end",
        "finish",
      ])
    })

    test("should handle tool call response", async () => {
      const mockFetch = createMockFetch(RESPONSE_FIXTURES.withToolCall)
      const model = createModel(mockFetch)

      const { stream } = await model.doStream({
        prompt: TEST_PROMPT,
        includeRawChunks: false,
      })

      const reader = stream.getReader()
      let toolCallFound = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === "tool-call") toolCallFound = true
      }
      expect(toolCallFound).toBe(true)
    })

    test("should handle code interpreter response", async () => {
      const mockFetch = createMockFetch(RESPONSE_FIXTURES.withCodeInterpreter)
      const model = createModel(mockFetch)

      const { stream } = await model.doStream({
        prompt: TEST_PROMPT,
        includeRawChunks: false,
      })

      const reader = stream.getReader()
      let codeInterpreterResultFound = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === "tool-result" && value.toolName === "code_interpreter") {
          codeInterpreterResultFound = true
        }
      }
      expect(codeInterpreterResultFound).toBe(true)
    })
  })

  describe("integration", () => {
    const apiKey = process.env.OPENAI_API_KEY
    const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"

    if (!apiKey) {
      test("skip when no API key", () => {
        console.log("Skipping integration tests: OPENAI_API_KEY not set")
      })
    } else {
      test("should work with real OpenAI API (non-streaming)", async () => {
        const model = new OpenAIResponsesLanguageModel("gpt-4.1", {
          provider: "openai",
          headers: () => ({ Authorization: `Bearer ${apiKey}` }),
          url: ({ path }) => `${baseURL}${path}`,
        })

        const result = await model.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Say 'test passed' in exactly 3 words" }] }],
        })

        const textContent = result.content.find((c) => c.type === "text")
        expect(textContent).toBeDefined()
        expect(result.finishReason.unified).toBe("stop")
      })

      test("should work with real OpenAI API (streaming)", async () => {
        const model = new OpenAIResponsesLanguageModel("gpt-4.1", {
          provider: "openai",
          headers: () => ({ Authorization: `Bearer ${apiKey}` }),
          url: ({ path }) => `${baseURL}${path}`,
        })

        const { stream } = await model.doStream({
          prompt: [{ role: "user", content: [{ type: "text", text: "Count from 1 to 3" }] }],
        })

        const reader = stream.getReader()
        let text = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value.type === "text-delta") {
            text += value.delta
          }
        }

        expect(text.length).toBeGreaterThan(0)
      })
    }
  })
})
