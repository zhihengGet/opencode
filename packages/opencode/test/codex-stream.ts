import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { streamText } from "ai"

const CODEX_SERVER_URL = process.env.CODEX_SERVER_URL || "http://127.0.0.1:4097"

const provider = createOpenAICompatible({
  name: "codex-local",
  baseURL: `${CODEX_SERVER_URL}/v1`,
  apiKey: "dummy-key",
})

async function testStreaming() {
  console.log("Testing streamText with gpt-5.3-codex-spark...")

  const model = provider("gpt-5.3-codex-spark")

  try {
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Count from 1 to 5" }],
    })

    let fullText = ""
    for await (const chunk of result.textStream) {
      fullText += chunk
      process.stdout.write(chunk)
    }
    console.log("\n\n✅ Full response:", fullText)
  } catch (err: any) {
    console.error("❌ FAILED:", err.message)
  }
}

testStreaming()
