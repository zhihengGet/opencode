import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, streamText } from "ai"

const CODEX_SERVER_URL = process.env.CODEX_SERVER_URL || "http://127.0.0.1:4097"

const provider = createOpenAICompatible({
  name: "codex-local",
  baseURL: `${CODEX_SERVER_URL}/v1`,
  apiKey: "dummy-key",
})

async function testChatCompletions() {
  console.log("Testing chat completions with gpt-5.3-codex...")

  const model = provider("gpt-5.3-codex")

  try {
    const result = await generateText({
      model,
      messages: [{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: "Say hello and identify yourself" }],
    })

    console.log("Response:", result.text)
    console.log("Usage:", result.usage)
  } catch (err) {
    console.error("Error:", err)
  }
}

async function testStreaming() {
  console.log("\nTesting streaming with gpt-5.3-codex-spark...")

  const model = provider("gpt-5.3-codex-spark")

  try {
    const result = streamText({
      model,
      messages: [{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: "Count from 1 to 5" }],
    })

    let fullText = ""
    for await (const chunk of result.textStream) {
      fullText += chunk
      process.stdout.write(chunk)
    }
    console.log("\nFull response:", fullText)
  } catch (err) {
    console.error("Error:", err)
  }
}

async function main() {
  await testChatCompletions()
  await testStreaming()
}

main()
