# OpenAI Codex OpenAI-Compatible Server

An OpenAI-compatible API server for OpenAI Codex that proxies requests to Codex-compatible endpoints and uses the auth token already stored by opencode.

## Features

- OpenAI-compatible `/v1/chat/completions` endpoint
- `/v1/responses` endpoint
- `/v1/completions` endpoint
- `/v1/models` endpoint
- Uses stored OAuth access token for provider `openai`
- Supports Codex streaming response passthrough
- No incoming `Authorization` header is required by clients

## Usage

Start the server from `packages/opencode`:

```bash
cd packages/opencode
bun run src/codex-server.ts
```

Default port: `4096`.

## Endpoints

| Method | Endpoint               | Description           |
| ------ | ---------------------- | --------------------- |
| GET    | `/health`              | Health check          |
| GET    | `/v1/models`           | List supported models |
| POST   | `/v1/chat/completions` | Chat completions      |
| POST   | `/v1/responses`        | Responses API         |
| POST   | `/v1/completions`      | Text completions      |

## Allowed Models

- `gpt-5.1-codex`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex-mini`
- `gpt-5.2`
- `gpt-5.2-codex`
- `gpt-5.3-codex`
- `gpt-5.4`
- `gpt-5.4-mini`

## Authentication

The server reads tokens from opencode auth storage and uses `openai` auth credentials.

Storage locations:

- Windows: `%APPDATA%/opencode/auth.json` or `%LOCALAPPDATA%/.local/share/opencode/auth.json`
- macOS/Linux: `~/.local/share/opencode/auth.json`

The token is refreshed automatically when expired using OpenAI OAuth refresh flow.

## Using with tools (example)

```bash
curl -X POST "http://127.0.0.1:4096/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.2","messages":[{"role":"user","content":"hi"}]}'
```

## Related

`packages/opencode/src/codex-server.ts`
