/**
 * security/tokenManager.js
 *
 * In-memory session store. Sessions are keyed by telegramId.
 * Expiry is read from the JWT's `exp` claim so the bot's notion of
 * "still logged in" aligns with what the backend will actually accept.
 * Falls back to 48 h if the token carries no parseable exp.
 */

const logger = require('../utils/logger');

const SESSION_TIMEOUT_MS = 48 * 60 * 60 * 1000; // 48 h fallback

const userSessions = {};

// ─── helpers ──────────────────────────────────────────────────────────────────

const jwtExpiresAt = (token) => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const { exp } = JSON.parse(json);
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
};

const resolveExpiry = (token) => jwtExpiresAt(token) ?? (Date.now() + SESSION_TIMEOUT_MS);

const refreshSessionTimer = (session) => {
  if (session) {
    session.lastActiveAt = Date.now();
    session.expiresAt    = Math.max(session.expiresAt, Date.now() + 60 * 1000); // keep alive on activity
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────

const storeToken = (telegramId, token, userId) => {
  userSessions[telegramId] = {
    token,
    userId,
    createdAt:    Date.now(),
    lastActiveAt: Date.now(),
    expiresAt:    resolveExpiry(token),
  };
  logger.debug({ telegramId }, 'session stored');
};

const getToken = (telegramId) => {
  const session = userSessions[telegramId];
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    delete userSessions[telegramId];
    logger.debug({ telegramId }, 'session expired');
    return null;
  }
  refreshSessionTimer(session);
  return session.token;
};

const getSession = (telegramId) => {
  const session = userSessions[telegramId];
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    delete userSessions[telegramId];
    logger.debug({ telegramId }, 'session expired');
    return null;
  }
  refreshSessionTimer(session);
  return session;
};

const removeToken = (telegramId) => {
  delete userSessions[telegramId];
  logger.debug({ telegramId }, 'session removed');
};

const isAuthenticated = (telegramId) => getToken(telegramId) !== null;

const refreshSession = (telegramId, newToken) => {
  const session = userSessions[telegramId];
  if (session) {
    session.token     = newToken;
    session.createdAt = Date.now();
    session.expiresAt = resolveExpiry(newToken);
    refreshSessionTimer(session);
    logger.debug({ telegramId }, 'session refreshed');
  }
};

module.exports = {
  storeToken,
  getToken,
  getSession,
  removeToken,
  isAuthenticated,
  refreshSession,
};
