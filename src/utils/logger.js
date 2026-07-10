/**
 * src/utils/logger.js
 *
 * Lightweight structured logger built on pino.
 *
 * Usage (same API as console but with structured context):
 *
 *   const logger = require('../utils/logger');
 *
 *   logger.info('bot started');
 *   logger.info({ telegramId, chatId }, 'user logged in');
 *   logger.error({ err }, 'something went wrong');
 *
 * In development (NODE_ENV !== 'production') output is pretty-printed via
 * pino-pretty so it is readable in a terminal.  In production it emits
 * newline-delimited JSON that log aggregators (Datadog, Loki, CloudWatch,
 * etc.) can ingest directly.
 */

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const transport = isDev
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      },
    }
  : undefined; // plain JSON to stdout

const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    base: { service: 'telegram-bot' },
  },
  transport ? pino.transport(transport) : undefined
);

module.exports = logger;
