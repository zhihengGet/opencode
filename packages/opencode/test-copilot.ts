const response = await fetch("http://127.0.0.1:5001/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [{ role: "user", content: "hi" }],
  }),
})

const text = await response.text()
console.log("Status:", response.status)
console.log("Response:", text)
