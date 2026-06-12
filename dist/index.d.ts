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
export {};
