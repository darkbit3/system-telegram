/**
 * src/bot.js — single entry point for the Telegram bot.
 *
 * Responsibilities:
 *   1. Load env, create the TelegramBot instance (polling).
 *   2. Attach all command / message / contact handlers.
 *   3. Surface polling errors as structured log lines, not crashes.
 *   4. Install process-level safety nets so unhandled rejections /
 *      uncaught exceptions are logged and the process stays alive.
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const logger      = require('./utils/logger');

// ── Validate required environment ────────────────────────────────────────────
const token = process.env.BOT_TOKEN;
if (!token) {
  logger.fatal('BOT_TOKEN is not set. Configure it in telegram/.env and restart.');
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
  // 409 Conflict is normal when two instances start at the same time;
  // everything else is worth a warn.
  const level = err.code === 'EFATAL' || String(err.message).includes('409')
    ? 'warn'
    : 'error';
  logger[level]({ err: err.message, code: err.code }, 'polling error');
});

// ── Process-level crash safety ────────────────────────────────────────────────
// These handlers keep the process alive so users' SQLite-persisted sessions
// and conversation states are not orphaned.  Errors are logged with full
// stack traces so they are easy to trace in production logs.

process.on('unhandledRejection', (reason, promise) => {
  logger.error(
    { reason: reason instanceof Error ? reason.message : String(reason),
      stack:  reason instanceof Error ? reason.stack  : undefined },
    'unhandledRejection — promise was not caught'
  );
  // Do NOT exit — the bot keeps running for all other users.
});

process.on('uncaughtException', (err, origin) => {
  logger.error({ err: err.message, stack: err.stack, origin }, 'uncaughtException');
  // Do NOT exit — same reasoning as above.
  // Note: if this fires it means something truly unexpected happened;
  // keep an eye on logs and consider graceful-restarts via a process
  // manager (pm2 / systemd) for persistent fatal errors.
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const shutdown = (signal) => {
  logger.info({ signal }, 'shutting down gracefully');
  bot.stopPolling().finally(() => process.exit(0));
};
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

logger.info({ backendUrl: process.env.BACKEND_URL }, '🤖 Telegram bot started');

module.exports = bot;
