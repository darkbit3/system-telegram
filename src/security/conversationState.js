/**
 * security/conversationState.js
 *
 * Conversation-state store backed by the system-backend API
 * (/api/bot/states). The local better-sqlite3 database has been removed;
 * all state data now lives in the system-backend's SQLite database.
 *
 * Public API (identical to the previous SQLite version):
 *   setState(chatId, step, data)
 *   getState(chatId)       → { step, data } | null
 *   updateState(chatId, patch)
 *   clearState(chatId)
 *   STATE_TIMEOUT_MS       (exported constant)
 *
 * All methods return Promises; callers must await them.
 */

const axios = require('axios');
const { BACKEND_URL } = require('../config/backend');
const logger = require('../utils/logger');

const STATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (unchanged)

// ─── Public API ───────────────────────────────────────────────────────────────

const setState = async (chatId, step, data = {}) => {
  try {
    await axios.put(`${BACKEND_URL}/api/bot/states/${chatId}`, { step, data });
    logger.debug({ chatId, step }, 'conversation state set in backend');
  } catch (err) {
    logger.error({ chatId, err: err.message }, 'conversationState.setState failed');
  }
};

const getState = async (chatId) => {
  try {
    const res = await axios.get(`${BACKEND_URL}/api/bot/states/${chatId}`);
    return res.data.state || null;
  } catch (err) {
    logger.error({ chatId, err: err.message }, 'conversationState.getState failed');
    return null;
  }
};

const updateState = async (chatId, patch = {}) => {
  try {
    const res = await axios.patch(`${BACKEND_URL}/api/bot/states/${chatId}`, { data: patch });
    return res.data.state || null;
  } catch (err) {
    logger.error({ chatId, err: err.message }, 'conversationState.updateState failed');
    return null;
  }
};

const clearState = async (chatId) => {
  try {
    await axios.delete(`${BACKEND_URL}/api/bot/states/${chatId}`);
    logger.debug({ chatId }, 'conversation state cleared from backend');
  } catch (err) {
    logger.error({ chatId, err: err.message }, 'conversationState.clearState failed');
  }
};

// Periodic GC: ask the backend to delete all expired rows every 5 minutes
setInterval(async () => {
  try {
    const res = await axios.delete(`${BACKEND_URL}/api/bot/states`);
    const deleted = res.data.deleted ?? 0;
    if (deleted > 0) {
      logger.debug({ deleted }, 'expired conversation states cleaned up via backend');
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'GC sweep for conversation_state failed');
  }
}, STATE_TIMEOUT_MS);

module.exports = {
  setState,
  getState,
  updateState,
  clearState,
  STATE_TIMEOUT_MS,
};
