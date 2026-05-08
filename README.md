# Agent Verifier MCP

MCP server implementing the [Budget Authority Protocol](https://github.com/goodmeta/agent-payments-landscape/blob/main/specs/budget-authority-protocol.md). Spending limits for AI agents. Two ways to connect:

**Option A: Local (npx)**
```json
{
  "mcpServers": {
    "budget": {
      "command": "npx",
      "args": ["@goodmeta/agent-verifier-mcp"],
      "env": { "VERIFIER_API_KEY": "gm_..." }
    }
  }
}
```

**Option B: Remote (no install)**
```json
{
  "mcpServers": {
    "budget": {
      "type": "streamable-http",
      "url": "https://verifier.goodmeta.co/mcp",
      "headers": { "Authorization": "Bearer gm_..." }
    }
  }
}
```

Then ask your agent:

> "Search Exa for agent payments research. Budget: $1."

The agent calls `create_budget`, `check_budget` before each payment, and `settle` after. If the budget runs out, the next payment is denied.

## Tools

| Tool | What it does |
| ---- | ------------ |
| `create_budget` | Set a spending limit ($10, 24 hours) |
| `check_budget` | Check if a purchase is allowed (places a hold) |
| `settle` | Confirm hold after payment, or release if payment failed |
| `get_budget` | Query remaining budget and history |

## How it works

```
Agent wants to buy something ($0.50)
  │
  ├── check_budget(budget_id, 50, "vendor")
  │     → "Approved. Hold ID: hold_abc. Remaining: $9.50"
  │
  ├── [agent makes the payment via x402/card/MPP/any rail]
  │
  └── settle(hold_id, success=true)
        → "Hold confirmed."
```

Budget enforcement is rail-agnostic. Works with x402, credit cards, MPP, bank transfers — the verifier tracks the budget, the payment method doesn't matter.

## Setup

Get a free API key:

```bash
curl -X POST https://verifier.goodmeta.co/setup/merchants \
  -H "Content-Type: application/json" \
  -d '{"names":["My Agent"]}'
```

Add the key to your MCP config. Done.

## Works with

- [Claude Code](https://claude.ai/code)
- Any MCP-compatible client (Cursor, Windsurf, Codex, OpenClaw)
- [agent-verifier](https://github.com/goodmeta/agent-verifier) npm package for programmatic use
- [demo-agent](https://github.com/goodmeta/demo-agent) for a full working example with real x402 payments

## Why

Five protocols let AI agents spend money (AP2, ACP, x402, MPP, UCP). None of them track what the agent spent across services. An agent calling Exa + Firecrawl + Nansen can overspend because each service approves independently. This MCP server is the missing budget layer.
