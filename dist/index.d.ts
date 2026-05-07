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
export {};
