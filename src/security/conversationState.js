/**
 * security/conversationState.js
 *
 * In-memory per-chat conversation state manager.
 * State is explicitly scoped per chatId so concurrent conversations
 * can never cross-talk, and each flow expires after 5 minutes of inactivity.
 */

const logger = require('../utils/logger');

const STATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const states = new Map();

const scheduleExpiry = (chatId) =>
  setTimeout(() => {
    states.delete(chatId);
    logger.debug({ chatId }, 'conversation state expired');
  }, STATE_TIMEOUT_MS);

const clearState = (chatId) => {
  const existing = states.get(chatId);
  if (existing?.timeoutHandle) clearTimeout(existing.timeoutHandle);
  states.delete(chatId);
  logger.debug({ chatId }, 'conversation state cleared');
};

const setState = (chatId, step, data = {}) => {
  clearState(chatId);
  states.set(chatId, {
    step,
    data,
    timeoutHandle: scheduleExpiry(chatId),
  });
  logger.debug({ chatId, step }, 'conversation state set');
};

const getState = (chatId) => states.get(chatId) || null;

const updateState = (chatId, patch = {}) => {
  const existing = states.get(chatId);
  if (!existing) return null;
  existing.data = { ...existing.data, ...patch };
  clearTimeout(existing.timeoutHandle);
  existing.timeoutHandle = scheduleExpiry(chatId);
  return existing;
};

module.exports = {
  setState,
  getState,
  updateState,
  clearState,
  STATE_TIMEOUT_MS,
};
