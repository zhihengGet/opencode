# GitHub Copilot OpenAI-Compatible Server

An OpenAI-compatible API server for GitHub Copilot that proxies requests to the GitHub Copilot API. Uses opencode's stored OAuth tokens for authentication.

## Features

- OpenAI-compatible `/v1/chat/completions` endpoint
- `/v1/models` endpoint
- `/v1/completions` endpoint
- Automatically uses OAuth token from opencode's auth storage
- Supports user-provided tokens as fallback

## Usage

### Start Server

```bash
cd packages/opencode
bun run src/copilot-server.ts
```

Default port: `4096`

## Endpoints

| Method | Endpoint               | Description           |
| ------ | ---------------------- | --------------------- |
| GET    | `/health`              | Health check          |
| GET    | `/v1/models`           | List available models |
| POST   | `/v1/chat/completions` | Chat completions      |
| POST   | `/v1/responses`        | Responses API         |
| POST   | `/v1/completions`      | Text completions      |

## Model Restrictions

Only these models are allowed:

- `gpt-4o`
- `gpt-4.1`
- `gpt-5-mini`
- `gpt-4o-mini`

## Authentication

The server **always uses OAuth tokens stored by opencode**. Any `Authorization` header sent by the client is ignored.

Auth is loaded from:

- Windows: `%APPDATA%/opencode/auth.json` or `%LOCALAPPDATA%/.local/share/opencode/auth.json`
- macOS/Linux: `~/.local/share/opencode/auth.json`

### Using with litellm

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      api_base: http://127.0.0.1:4096/v1
      model: openai/gpt-4o
      api_key: any-value-here # ignored
```

Note: The `api_key` value is ignored - the server uses opencode's stored token.

### Using with curl

```bash
# Auth header is ignored - uses opencode stored token
curl -X POST "http://127.0.0.1:4096/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'
```

## Setting Up GitHub Copilot Auth

If you don't have a stored token, authenticate via opencode:

```bash
# Run opencode and use the UI to login to GitHub Copilot
opencode
```

Or use the OAuth device flow:

```bash
# Step 1: Get device code
curl -X POST http://127.0.0.1:5001/login/github-copilot

# Step 2: After authorizing in browser
curl -X POST http://127.0.0.1:5001/login/github-copilot/poll
```

## Models

The server proxies to GitHub Copilot and supports all available models including:

- `gpt-4o`
- `gpt-4o-mini`
- `gpt-4.1`
- Claude models (via GitHub Copilot)
- Gemini models (via GitHub Copilot)

## Troubleshooting

### "No auth configured" error

Ensure you have authenticated with GitHub Copilot via opencode first. The token is stored in `auth.json`.

### Port already in use

指定不同的端口:

```bash
PORT=5002 bun run src/copilot-server.ts
```

### Connection refused

Ensure the server is running on the correct port. Check the startup output for the port number.

## Environment Variables

| Variable      | Description             | Default          |
| ------------- | ----------------------- | ---------------- |
| PORT          | Server port             | 4096             |
| OPENCODE_DATA | opencode data directory | Platform default |
| XDG_DATA_HOME | XDG data directory      | ~/.local/share   |

## Code

Location: `packages/opencode/src/copilot-server.ts`
