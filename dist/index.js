#!/usr/bin/env node
/**
 * Agent Verifier MCP Server
 *
 * Spending limits for AI agents. Create budgets, enforce limits, and track
 * spend across services — a thin stdio client over the hosted Verifier API
 * (verifier.goodmeta.co). Mirrors the hosted /mcp tool set.
 *
 * Tools:
 *   create_budget      — set a spending limit
 *   check_budget       — check if a spend is allowed (places a hold)
 *   settle             — confirm or release a hold after payment
 *   release            — return a pre-commit hold to the budget (before settle)
 *   refund             — reverse a settled payment, fully or partially
 *   get_budget         — query remaining budget + recent spend
 *   query_reservation  — look up a single hold's state
 *
 * Works with any payment method (x402, cards, MPP, bank transfers).
 * The verifier tracks the budget — the payment rail doesn't matter.
 *
 * Usage:
 *   npx @goodmeta/agent-verifier-mcp          # stdio (Claude Code)
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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const VERIFIER_URL = (process.env.VERIFIER_URL ?? 'https://verifier.goodmeta.co').replace(/\/$/, '');
const API_KEY = process.env.VERIFIER_API_KEY ?? '';
function headers() {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
    };
}
const text = (s) => ({ content: [{ type: 'text', text: s }] });
const fail = (s) => ({ content: [{ type: 'text', text: s }], isError: true });
const usd = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;
const remainingText = (mandate) => mandate?.remainingBudget !== undefined ? usd(mandate.remainingBudget) : 'uncapped';
async function post(path, body) {
    const res = await fetch(`${VERIFIER_URL}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}
async function get(path) {
    const res = await fetch(`${VERIFIER_URL}${path}`, { headers: headers() });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}
const server = new McpServer({
    name: 'agent-verifier',
    version: '0.2.0',
});
// ── create_budget ───────────────────────────────────────────
server.tool('create_budget', 'Create a spending budget for this agent. Set a limit before making purchases.', {
    amount_dollars: z.number().positive().describe('Budget limit in dollars (e.g. 10.00 for $10)'),
    currency: z.string().default('usd').describe('Currency code (default: usd)'),
    valid_hours: z.number().positive().default(24).describe('How many hours the budget is valid (default: 24)'),
}, async ({ amount_dollars, currency, valid_hours }) => {
    if (!API_KEY) {
        return fail('Missing VERIFIER_API_KEY. Set it in your MCP config env.');
    }
    const validUntil = new Date(Date.now() + valid_hours * 60 * 60 * 1000).toISOString();
    const budgetCents = Math.round(amount_dollars * 100);
    const { ok, data } = await post('/v1/budgets', {
        agentId: 'mcp-agent',
        budgetTotal: budgetCents,
        currency,
        validUntil,
    });
    if (!ok) {
        return fail(`Failed to create budget: ${JSON.stringify(data)}`);
    }
    return text([
        `Budget created.`,
        `  ID: ${data.id}`,
        `  Limit: ${usd(budgetCents)} ${currency.toUpperCase()}`,
        `  Valid until: ${validUntil}`,
        ``,
        `Use this budget_id with check_budget before each purchase.`,
    ].join('\n'));
});
// ── check_budget ────────────────────────────────────────────
server.tool('check_budget', 'Check if a purchase is within budget. Call BEFORE making a payment. Returns a hold_id to settle after.', {
    budget_id: z.string().describe('Budget ID from create_budget'),
    amount_cents: z.number().int().positive().describe('Amount in cents (e.g. 700 for $7.00)'),
    vendor: z.string().describe('Who you are paying (e.g. "exa.ai")'),
}, async ({ budget_id, amount_cents, vendor }) => {
    const { status, data } = await post('/v1/check', {
        budget_id,
        amount_cents,
        vendor,
        idempotency_key: crypto.randomUUID().replace(/-/g, ''),
    });
    if (status === 200 && data.approved) {
        return text([
            `Approved. Proceed with payment.`,
            `  Hold ID: ${data.hold_id}`,
            `  Remaining: ${usd(data.remaining_cents ?? 0)}`,
            ``,
            `After payment, call settle with this hold_id.`,
        ].join('\n'));
    }
    return text(`Denied. ${data.reason ?? 'Budget exceeded.'}`);
});
// ── settle ──────────────────────────────────────────────────
server.tool('settle', 'Confirm or cancel a payment hold. Call AFTER payment succeeds (success=true) or fails (success=false).', {
    hold_id: z.string().describe('Hold ID from check_budget'),
    success: z.boolean().describe('true if payment succeeded, false to release the hold'),
}, async ({ hold_id, success }) => {
    const { ok, data } = await post('/v1/settle', { hold_id, success });
    if (!ok) {
        return fail(`Settle failed: ${JSON.stringify(data)}`);
    }
    return text(`Hold ${hold_id} ${success ? 'confirmed' : 'released'}.`);
});
// ── release ─────────────────────────────────────────────────
server.tool('release', 'Release a pre-commit hold, returning the unspent reservation to the budget. Use when a planned payment is cancelled BEFORE it settles. For already-settled payments use refund instead.', {
    hold_id: z.string().describe('Hold ID from check_budget'),
}, async ({ hold_id }) => {
    const { ok, data } = await post('/v1/release', { hold_id });
    if (!ok) {
        return fail(`Release failed: ${data.error ?? JSON.stringify(data)}${data.detail ? ` — ${data.detail}` : ''}`);
    }
    return text(`Hold ${hold_id} released. Remaining: ${remainingText(data.mandate)}.`);
});
// ── refund ──────────────────────────────────────────────────
server.tool('refund', 'Refund a settled (already-committed) payment, fully or partially. Reverses the spend and restores budget. For pre-commit cancellations use release instead.', {
    hold_id: z.string().describe('Hold ID of the settled payment to refund'),
    amount_cents: z.number().int().positive().describe('Amount to refund in cents'),
    idempotency_key: z
        .string()
        .optional()
        .describe('Stable key that makes retries safe. If omitted one is generated, but a retry without the same key will refund again.'),
}, async ({ hold_id, amount_cents, idempotency_key }) => {
    const key = idempotency_key ?? crypto.randomUUID().replace(/-/g, '');
    const { ok, data } = await post('/v1/refund', { hold_id, amount_cents, idempotency_key: key });
    if (!ok) {
        return fail(`Refund failed: ${data.error ?? JSON.stringify(data)}${data.detail ? ` — ${data.detail}` : ''}`);
    }
    const replay = data.idempotentReplay ? ' (idempotent replay — no double refund)' : '';
    const status = data.status ?? 'refunded';
    return text(`Refunded ${usd(amount_cents)} on ${hold_id} [${status}]${replay}. Remaining: ${remainingText(data.mandate)}.`);
});
// ── get_budget ──────────────────────────────────────────────
server.tool('get_budget', 'Check remaining budget and spending history.', {
    budget_id: z.string().describe('Budget ID from create_budget'),
}, async ({ budget_id }) => {
    const { ok, data } = await get(`/v1/mandates/${encodeURIComponent(budget_id)}`);
    if (!ok) {
        return fail(`Budget not found: ${budget_id}`);
    }
    const m = data.mandate;
    const txs = data.transactions ?? [];
    const lines = [
        `Budget: ${m.id}`,
        `  Total:     ${usd(m.budgetTotal)}`,
        `  Spent:     ${usd(m.budgetSpent)}`,
        `  Remaining: ${usd(m.remainingBudget)}`,
        `  Transactions: ${m.txCount}`,
    ];
    if (txs.length > 0) {
        lines.push('', '  Recent:');
        for (const tx of txs.slice(0, 5)) {
            lines.push(`    ${tx.status} ${usd(tx.amount)} → ${tx.merchant_id}`);
        }
    }
    return text(lines.join('\n'));
});
// ── query_reservation ───────────────────────────────────────
server.tool('query_reservation', 'Look up the state of a single reservation/hold by its ID (held, settled, released, refunded, etc.).', {
    hold_id: z.string().describe('Hold ID from check_budget'),
}, async ({ hold_id }) => {
    const { ok, data: r } = await get(`/v1/reservations/${encodeURIComponent(hold_id)}`);
    if (!ok) {
        return fail(`Reservation not found: ${hold_id}`);
    }
    const lines = [
        `Reservation ${r.reservationId}`,
        `  State:   ${r.state}`,
        `  Amount:  ${usd(r.amount)} ${String(r.currency).toUpperCase()}`,
        `  Vendor:  ${r.vendor}`,
    ];
    if (Number(r.refundedAmount) > 0)
        lines.push(`  Refunded: ${usd(r.refundedAmount)}`);
    return text(lines.join('\n'));
});
// ── Start ───────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[agent-verifier] MCP server running (stdio)');
