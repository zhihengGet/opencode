import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

const CODEX_SERVER_URL = process.env.CODEX_SERVER_URL || "http://127.0.0.1:4097"

async function testToolCall() {
  console.log("Testing tool call with gpt-5.3-codex...")

  // Test with direct fetch first to see raw response
  const res = await fetch(`${CODEX_SERVER_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.3-codex",
      messages: [{ role: "user", content: "Calculate (123.45 * 67.89) / 3.14159. You must use the calculator tool." }],
      tools: [{
        type: "function",
        name: "calculator",
        description: "Calculate mathematical expressions",
        parameters: {
          type: "object",
          properties: {
            expression: { type: "string" },
          },
          required: ["expression"],
        },
      }],
    }),
  })

  const data = await res.json()
  console.log("Status:", res.status)
  console.log("Response:", JSON.stringify(data, null, 2))

  // Check if tool_calls exist in response
  if (data.choices?.[0]?.message?.tool_calls) {
    console.log("✅ Tool calls found!")
  } else {
    console.log("ℹ️ No tool calls in response (model chose not to use them)")
  }
}

testToolCall().catch(console.error)
