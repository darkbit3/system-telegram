/**
 * security/conversationState.js
 *
 * Persistent conversation-state store backed by SQLite.
 *
 * Public API is identical to the previous in-memory version so no handler
 * code needs to change:
 *   setState(chatId, step, data)
 *   getState(chatId)       → { step, data } | null
 *   updateState(chatId, patch)
 *   clearState(chatId)
 *   STATE_TIMEOUT_MS       (exported constant)
 *
 * In-progress flows now survive a bot restart or deploy.  The 5-minute
 * inactivity timeout is still enforced: expired rows are either deleted
 * lazily on read or cleaned up by a periodic sweep.
 */

const db = require('../store/db');
const logger = require('../utils/logger');

const STATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (unchanged)

// ─── Prepared statements ──────────────────────────────────────────────────────
const stmtUpsert = db.prepare(`
  INSERT INTO conversation_state (chat_id, step, data, expires_at)
  VALUES (@chatId, @step, @data, @expiresAt)
  ON CONFLICT(chat_id) DO UPDATE SET
    step       = excluded.step,
    data       = excluded.data,
    expires_at = excluded.expires_at
`);

const stmtGet = db.prepare(`
  SELECT * FROM conversation_state WHERE chat_id = ?
`);

const stmtDelete = db.prepare(`
  DELETE FROM conversation_state WHERE chat_id = ?
`);

const stmtUpdateData = db.prepare(`
  UPDATE conversation_state
  SET data = @data, expires_at = @expiresAt
  WHERE chat_id = @chatId
`);

// Periodic GC: delete all expired rows (runs every 5 minutes)
const stmtDeleteExpired = db.prepare(`
  DELETE FROM conversation_state WHERE expires_at < ?
`);

setInterval(() => {
  try {
    const { changes } = stmtDeleteExpired.run(Date.now());
    if (changes > 0) logger.debug({ changes }, 'expired conversation states cleaned up');
  } catch (err) {
    logger.warn({ err }, 'GC sweep for conversation_state failed');
  }
}, STATE_TIMEOUT_MS);

// ─── helpers ──────────────────────────────────────────────────────────────────
const nextExpiry = () => Date.now() + STATE_TIMEOUT_MS;

// ─── Public API ───────────────────────────────────────────────────────────────

const setState = (chatId, step, data = {}) => {
  stmtUpsert.run({
    chatId:    String(chatId),
    step,
    data:      JSON.stringify(data),
    expiresAt: nextExpiry(),
  });
  logger.debug({ chatId, step }, 'conversation state set');
};

const getState = (chatId) => {
  const row = stmtGet.get(String(chatId));
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    stmtDelete.run(String(chatId));
    logger.debug({ chatId }, 'conversation state expired');
    return null;
  }
  return {
    step: row.step,
    data: JSON.parse(row.data),
  };
};

const updateState = (chatId, patch = {}) => {
  const existing = getState(chatId);
  if (!existing) return null;

  const merged = { ...existing.data, ...patch };
  stmtUpdateData.run({
    chatId:    String(chatId),
    data:      JSON.stringify(merged),
    expiresAt: nextExpiry(), // refresh on retry, same as the old implementation
  });
  return { step: existing.step, data: merged };
};

const clearState = (chatId) => {
  stmtDelete.run(String(chatId));
  logger.debug({ chatId }, 'conversation state cleared');
};

module.exports = {
  setState,
  getState,
  updateState,
  clearState,
  STATE_TIMEOUT_MS,
};
