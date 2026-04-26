const CODEX_SERVER_URL = process.env.CODEX_SERVER_URL || "http://127.0.0.1:4097"

async function testStructuredOutput() {
  console.log("Testing structured output with gpt-5.3-codex...")

  const res = await fetch(`${CODEX_SERVER_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.3-codex",
      messages: [{ role: "user", content: "List 3 colors as JSON with name and hex fields" }],
      response_format: { type: "json_object" },
    }),
  })

  const data = await res.json()
  console.log("Status:", res.status)
  console.log("Response:", JSON.stringify(data, null, 2))

  // Check if response is valid JSON
  const content = data.choices?.[0]?.message?.content
  if (content) {
    try {
      const parsed = JSON.parse(content)
      console.log("✅ Valid JSON response:", JSON.stringify(parsed, null, 2))
    } catch {
      console.log("❌ Response is not valid JSON:", content)
    }
  }
}

testStructuredOutput().catch(console.error)
