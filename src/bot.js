/**
 * src/bot.js — single entry point for the Telegram bot.
 *
 * Responsibilities:
 *   1. Load env, create the TelegramBot instance (polling).
 *   2. Attach all command / message / contact handlers.
 *   3. Surface polling errors as structured log lines, not crashes.
 *   4. Install process-level safety nets so unhandled rejections /
 *      uncaught exceptions are logged and the process stays alive.
 *
 * Sessions and conversation states are stored in the system-backend database
 * via REST API calls to /api/bot/sessions and /api/bot/states.
 * There is no local SQLite database in this process.
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const logger      = require('./utils/logger');
const http        = require('http');
const { BACKEND_URL } = require('./config/backend');

// ── Minimal health-check HTTP server ─────────────────────────────────────────
// Render Web Services require at least one open port.
// If you deploy this as a Background Worker on Render, this block is not
// needed — background workers have no port requirement.
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'telegram-bot' }));
}).listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, '🩺 Health-check server listening on 0.0.0.0');
});

// ── Validate required environment ────────────────────────────────────────────
const token = process.env.BOT_TOKEN;
if (!token) {
  logger.fatal('BOT_TOKEN is not set. Configure it in your environment and restart.');
  process.exit(1);
}

// ── Create bot (single instance, single polling loop) ────────────────────────
const bot = new TelegramBot(token, { polling: true });

// ── Attach handlers ───────────────────────────────────────────────────────────
const { handleCommands, handleContacts } = require('./handler/commandHandler');
const { handleMessages }                 = require('./handler/messageHandler');

handleCommands(bot);
handleContacts(bot);
handleMessages(bot);

// ── Polling errors — log but never crash ─────────────────────────────────────
bot.on('polling_error', (err) => {
  const level = err.code === 'EFATAL' || String(err.message).includes('409')
    ? 'warn'
    : 'error';
  logger[level]({ err: err.message, code: err.code }, 'polling error');
});

// ── Process-level crash safety ────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error(
    {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack:  reason instanceof Error ? reason.stack  : undefined,
    },
    'unhandledRejection — promise was not caught'
  );
  // Do NOT exit — the bot keeps running for all other users.
});

process.on('uncaughtException', (err, origin) => {
  logger.error({ err: err.message, stack: err.stack, origin }, 'uncaughtException');
  // Do NOT exit — same reasoning as above.
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const shutdown = (signal) => {
  logger.info({ signal }, 'shutting down gracefully');
  bot.stopPolling().finally(() => process.exit(0));
};
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

logger.info({ backendUrl: BACKEND_URL }, '🤖 Telegram bot started');

module.exports = bot;
