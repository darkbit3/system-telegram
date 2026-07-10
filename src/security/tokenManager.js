/**
 * security/tokenManager.js
 *
 * Session store backed by the system-backend API (/api/bot/sessions).
 * The local better-sqlite3 database has been removed; all session data
 * now lives in the system-backend's SQLite database.
 *
 * Public API (identical to the previous SQLite version):
 *   storeToken(telegramId, token, userId)
 *   getToken(telegramId)          → token string | null
 *   getSession(telegramId)        → session object | null
 *   removeToken(telegramId)
 *   isAuthenticated(telegramId)   → boolean
 *   refreshSession(telegramId, newToken)
 *
 * All methods are synchronous-looking wrappers that return Promises.
 * Callers that need the result must await them.
 */

const axios = require('axios');
const { BACKEND_URL } = require('../config/backend');
const logger = require('../utils/logger');

// Fallback expiry when the JWT carries no `exp` claim (48 h)
const SESSION_TIMEOUT_MS = 48 * 60 * 60 * 1000;

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Decode the `exp` field from a JWT without verifying the signature.
 * Returns the expiry timestamp in milliseconds, or null.
 */
const jwtExpiresAt = (token) => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(
      payload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    const { exp } = JSON.parse(json);
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
};

const resolveExpiry = (token) =>
  jwtExpiresAt(token) ?? (Date.now() + SESSION_TIMEOUT_MS);

// ─── Public API ───────────────────────────────────────────────────────────────

const storeToken = async (telegramId, token, userId) => {
  const now = Date.now();
  try {
    await axios.put(`${BACKEND_URL}/api/bot/sessions/${telegramId}`, {
      token,
      userId:     String(userId),
      createdAt:  now,
      lastActive: now,
      expiresAt:  resolveExpiry(token),
    });
    logger.debug({ telegramId }, 'session stored in backend');
  } catch (err) {
    logger.error({ telegramId, err: err.message }, 'tokenManager.storeToken failed');
  }
};

const getToken = async (telegramId) => {
  const session = await getSession(telegramId);
  return session ? session.token : null;
};

const getSession = async (telegramId) => {
  try {
    const res = await axios.get(`${BACKEND_URL}/api/bot/sessions/${telegramId}`);
    return res.data.session || null;
  } catch (err) {
    logger.error({ telegramId, err: err.message }, 'tokenManager.getSession failed');
    return null;
  }
};

const removeToken = async (telegramId) => {
  try {
    await axios.delete(`${BACKEND_URL}/api/bot/sessions/${telegramId}`);
    logger.debug({ telegramId }, 'session removed from backend');
  } catch (err) {
    logger.error({ telegramId, err: err.message }, 'tokenManager.removeToken failed');
  }
};

const isAuthenticated = async (telegramId) => {
  const token = await getToken(telegramId);
  return token !== null;
};

const refreshSession = async (telegramId, newToken) => {
  try {
    await axios.patch(`${BACKEND_URL}/api/bot/sessions/${telegramId}/token`, {
      token:     newToken,
      expiresAt: resolveExpiry(newToken),
    });
    logger.debug({ telegramId }, 'session refreshed in backend');
  } catch (err) {
    logger.error({ telegramId, err: err.message }, 'tokenManager.refreshSession failed');
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
