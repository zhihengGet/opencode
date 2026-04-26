import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText } from "ai"

const CODEX_SERVER_URL = process.env.CODEX_SERVER_URL || "http://127.0.0.1:4097"

const provider = createOpenAICompatible({
  name: "codex-local",
  baseURL: `${CODEX_SERVER_URL}/v1`,
  apiKey: "dummy-key",
})

async function testGenerateText() {
  console.log("Testing generateText with gpt-5.3-codex...")

  const model = provider("gpt-5.3-codex")

  try {
    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Say hello in one word" }],
    })

    console.log("✅ SUCCESS!")
    console.log("Response:", result.text)
    console.log("Usage:", result.usage)
  } catch (err: any) {
    console.error("❌ FAILED:", err.message)
    if (err.responseBody) {
      console.error("Response body:", err.responseBody)
    }
  }
}

testGenerateText()
