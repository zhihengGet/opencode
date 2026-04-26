const CODEX_SERVER_URL = process.env.CODEX_SERVER_URL || "http://127.0.0.1:4097"

async function testCodexDirect() {
  console.log("Testing gpt-5.3-codex with Codex API format...")

  const res = await fetch(`${CODEX_SERVER_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.3-codex",
      instructions: "You are a helpful coding assistant.",
      input: [{ role: "user", content: "Write a hello world in TypeScript" }],
      store: false,
      stream: true,
    }),
  })

  console.log("Status:", res.status)
  console.log("Content-Type:", res.headers.get("content-type"))

  if (res.body) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let fullText = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6)
          if (data === "[DONE]") {
            console.log("\n\n[DONE]")
            console.log("Full response:", fullText)
            return
          }
          try {
            const parsed = JSON.parse(data)
            const content = parsed.choices?.[0]?.delta?.content || parsed.output?.[0]?.content?.[0]?.text
            if (content) {
              fullText += content
              process.stdout.write(content)
            }
          } catch {}
        }
      }
    }
  }
}

async function testCodexSpark() {
  console.log("\nTesting gpt-5.3-codex-spark with streaming...")

  const res = await fetch(`${CODEX_SERVER_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.3-codex-spark",
      instructions: "You are a helpful coding assistant.",
      input: [{ role: "user", content: "Count from 1 to 3" }],
      store: false,
      stream: true,
    }),
  })

  console.log("Status:", res.status)
  console.log("Content-Type:", res.headers.get("content-type"))

  if (res.body) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6)
          if (data === "[DONE]") {
            console.log("\n[DONE]")
            return
          }
          try {
            const parsed = JSON.parse(data)
            const content = parsed.choices?.[0]?.delta?.content
            if (content) {
              process.stdout.write(content)
            }
          } catch {}
        }
      }
    }
  }
}

async function main() {
  await testCodexDirect()
  await testCodexSpark()
}

main().catch(console.error)
