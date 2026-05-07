#!/usr/bin/env node
/**
 * Agent Verifier MCP Server
 *
 * Spending limits for AI agents. Create budgets, enforce limits,
 * track spend across services.
 *
 * Tools:
 *   create_budget     — set a spending limit
 *   check_budget      — check if a spend is allowed (places hold)
 *   settle            — confirm or release a hold after payment
 *   get_budget        — query remaining budget
 *   list_transactions — view spending history
 *
 * Works with any payment method (x402, cards, MPP, bank transfers).
 * The verifier tracks the budget — the payment rail doesn't matter.
 *
 * Usage:
 *   npx @goodmeta/agent-verifier-mcp          # stdio (Claude Code)
 *   npx @goodmeta/agent-verifier-mcp --http   # HTTP transport
 *
 * Claude Code config:
 *   {
 *     "mcpServers": {
 *       "budget": {
 *         "command": "npx",
 *         "args": ["@goodmeta/agent-verifier-mcp"],
 *         "env": { "VERIFIER_API_KEY": "gm_..." }
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const VERIFIER_URL = (
  process.env.VERIFIER_URL ?? 'https://verifier.goodmeta.co'
).replace(/\/$/, '')
const API_KEY = process.env.VERIFIER_API_KEY ?? ''

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  }
}

const server = new McpServer({
  name: 'agent-verifier',
  version: '0.1.0',
})

// ── create_budget ───────────────────────────────────────────

server.tool(
  'create_budget',
  'Create a spending budget for this agent. Set a limit before making purchases.',
  {
    amount_dollars: z
      .number()
      .positive()
      .describe('Budget limit in dollars (e.g. 10.00 for $10)'),
    currency: z
      .string()
      .default('usd')
      .describe('Currency code (default: usd)'),
    valid_hours: z
      .number()
      .positive()
      .default(24)
      .describe('How many hours the budget is valid (default: 24)'),
  },
  async ({ amount_dollars, currency, valid_hours }) => {
    if (!API_KEY) {
      return {
        content: [
          {
            type: 'text',
            text: 'Missing VERIFIER_API_KEY. Set it in your MCP config env.',
          },
        ],
        isError: true,
      }
    }

    const validUntil = new Date(
      Date.now() + valid_hours * 60 * 60 * 1000
    ).toISOString()
    const budgetCents = Math.round(amount_dollars * 100)

    const res = await fetch(`${VERIFIER_URL}/v1/budgets`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        agentId: 'mcp-agent',
        budgetTotal: budgetCents,
        currency,
        validUntil,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to create budget: ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: [
            `Budget created.`,
            `  ID: ${data.id}`,
            `  Limit: $${amount_dollars.toFixed(2)} ${currency.toUpperCase()}`,
            `  Valid until: ${validUntil}`,
            ``,
            `Use this budget_id with check_budget before each purchase.`,
          ].join('\n'),
        },
      ],
    }
  }
)

// ── check_budget ────────────────────────────────────────────

server.tool(
  'check_budget',
  'Check if a purchase is within budget. Call BEFORE making a payment. Returns a hold_id to settle after.',
  {
    budget_id: z.string().describe('Budget ID from create_budget'),
    amount_cents: z
      .number()
      .int()
      .positive()
      .describe('Amount in cents (e.g. 700 for $7.00)'),
    vendor: z.string().describe('Who you are paying (e.g. "exa.ai")'),
  },
  async ({ budget_id, amount_cents, vendor }) => {
    const res = await fetch(`${VERIFIER_URL}/v1/check`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        budget_id,
        amount_cents,
        vendor,
        idempotency_key: crypto.randomUUID().replace(/-/g, ''),
      }),
    })

    const data = await res.json()

    if (res.status === 200 && data.approved) {
      return {
        content: [
          {
            type: 'text',
            text: [
              `Approved. Proceed with payment.`,
              `  Hold ID: ${data.hold_id}`,
              `  Remaining: $${((data.remaining_cents ?? 0) / 100).toFixed(2)}`,
              ``,
              `After payment, call settle with this hold_id.`,
            ].join('\n'),
          },
        ],
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `Denied. ${data.reason ?? 'Budget exceeded.'}`,
        },
      ],
    }
  }
)

// ── settle ──────────────────────────────────────────────────

server.tool(
  'settle',
  'Confirm or cancel a payment hold. Call AFTER payment succeeds (success=true) or fails (success=false).',
  {
    hold_id: z.string().describe('Hold ID from check_budget'),
    success: z
      .boolean()
      .describe('true if payment succeeded, false to release the hold'),
  },
  async ({ hold_id, success }) => {
    const res = await fetch(`${VERIFIER_URL}/v1/settle`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ hold_id, success }),
    })

    const label = success ? 'confirmed' : 'released'

    if (res.ok) {
      return {
        content: [
          {
            type: 'text',
            text: `Hold ${hold_id} ${label}.`,
          },
        ],
      }
    }

    const data = await res.json()
    return {
      content: [
        {
          type: 'text',
          text: `Settle failed: ${JSON.stringify(data)}`,
        },
      ],
      isError: true,
    }
  }
)

// ── get_budget ──────────────────────────────────────────────

server.tool(
  'get_budget',
  'Check remaining budget and spending history.',
  {
    budget_id: z.string().describe('Budget ID from create_budget'),
  },
  async ({ budget_id }) => {
    const res = await fetch(
      `${VERIFIER_URL}/v1/mandates/${budget_id}`,
      { headers: headers() }
    )

    if (!res.ok) {
      return {
        content: [
          { type: 'text', text: `Budget not found: ${budget_id}` },
        ],
        isError: true,
      }
    }

    const data = await res.json()
    const m = data.mandate
    const txs = data.transactions ?? []

    const lines = [
      `Budget: ${m.id}`,
      `  Total:     $${(parseInt(m.budgetTotal) / 100).toFixed(2)}`,
      `  Spent:     $${(parseInt(m.budgetSpent) / 100).toFixed(2)}`,
      `  Remaining: $${(parseInt(m.remainingBudget) / 100).toFixed(2)}`,
      `  Transactions: ${m.txCount}`,
    ]

    if (txs.length > 0) {
      lines.push('', '  Recent:')
      for (const tx of txs.slice(0, 5)) {
        lines.push(
          `    ${tx.status} $${(tx.amount / 100).toFixed(2)} → ${tx.merchant_id}`
        )
      }
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    }
  }
)

// ── Start ───────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[agent-verifier] MCP server running (stdio)')
