/**
 * security/tokenManager.js
 *
 * Persistent session store backed by SQLite (better-sqlite3).
 *
 * Public API is identical to the previous in-memory version so no handler
 * code needs to change:
 *   storeToken(telegramId, token, userId)
 *   getToken(telegramId)          → token string | null
 *   getSession(telegramId)        → session object | null
 *   removeToken(telegramId)
 *   isAuthenticated(telegramId)   → boolean
 *   refreshSession(telegramId, newToken)
 *
 * Session expiry: we decode the JWT's `exp` claim and use that as the
 * session's expiry so the bot's notion of "still logged in" can never
 * outlive the token the backend will actually accept.  If the token has no
 * parseable exp (e.g. during tests) we fall back to SESSION_TIMEOUT_MS.
 */

const db = require('../store/db');
const logger = require('../utils/logger');

// Fallback timeout used only when the JWT carries no `exp` claim (48 h,
// matches the system-backend JWT setting).
const SESSION_TIMEOUT_MS = 48 * 60 * 60 * 1000;

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Decode the `exp` field from a JWT without verifying the signature.
 * The bot trusts the backend to issue valid tokens; it just needs the
 * expiry so it doesn't keep a dead token in the DB.
 *
 * Returns the exp timestamp in milliseconds, or null if not decodable.
 */
const jwtExpiresAt = (token) => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    // base64url → base64 standard
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const { exp } = JSON.parse(json);
    return typeof exp === 'number' ? exp * 1000 : null; // convert s → ms
  } catch {
    return null;
  }
};

const resolveExpiry = (token) => {
  const fromJwt = jwtExpiresAt(token);
  return fromJwt ?? (Date.now() + SESSION_TIMEOUT_MS);
};

// ─── Prepared statements (compiled once, reused for every call) ───────────────
const stmtUpsert = db.prepare(`
  INSERT INTO sessions (telegram_id, token, user_id, created_at, last_active, expires_at)
  VALUES (@telegramId, @token, @userId, @createdAt, @lastActive, @expiresAt)
  ON CONFLICT(telegram_id) DO UPDATE SET
    token       = excluded.token,
    user_id     = excluded.user_id,
    created_at  = excluded.created_at,
    last_active = excluded.last_active,
    expires_at  = excluded.expires_at
`);

const stmtGet = db.prepare(`
  SELECT * FROM sessions WHERE telegram_id = ?
`);

const stmtTouch = db.prepare(`
  UPDATE sessions SET last_active = ? WHERE telegram_id = ?
`);

const stmtDelete = db.prepare(`
  DELETE FROM sessions WHERE telegram_id = ?
`);

const stmtUpdateToken = db.prepare(`
  UPDATE sessions
  SET token = @token, created_at = @createdAt, last_active = @lastActive, expires_at = @expiresAt
  WHERE telegram_id = @telegramId
`);

// ─── Public API ───────────────────────────────────────────────────────────────

const storeToken = (telegramId, token, userId) => {
  const now = Date.now();
  stmtUpsert.run({
    telegramId: String(telegramId),
    token,
    userId:     String(userId),
    createdAt:  now,
    lastActive: now,
    expiresAt:  resolveExpiry(token),
  });
  logger.debug({ telegramId }, 'session stored');
};

const _loadValid = (telegramId) => {
  const row = stmtGet.get(String(telegramId));
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    stmtDelete.run(String(telegramId));
    logger.debug({ telegramId }, 'session expired and removed');
    return null;
  }
  // refresh last-active timestamp on every read
  stmtTouch.run(Date.now(), String(telegramId));
  return row;
};

const getToken = (telegramId) => {
  const row = _loadValid(telegramId);
  return row ? row.token : null;
};

const getSession = (telegramId) => {
  const row = _loadValid(telegramId);
  if (!row) return null;
  // Expose the same shape the handlers expect
  return {
    token:        row.token,
    userId:       row.user_id,
    createdAt:    row.created_at,
    lastActiveAt: row.last_active,
    expiresAt:    row.expires_at,
  };
};

const removeToken = (telegramId) => {
  stmtDelete.run(String(telegramId));
  logger.debug({ telegramId }, 'session removed');
};

const isAuthenticated = (telegramId) => getToken(telegramId) !== null;

const refreshSession = (telegramId, newToken) => {
  const now = Date.now();
  stmtUpdateToken.run({
    telegramId:  String(telegramId),
    token:       newToken,
    createdAt:   now,
    lastActive:  now,
    expiresAt:   resolveExpiry(newToken),
  });
  logger.debug({ telegramId }, 'session refreshed');
};

module.exports = {
  storeToken,
  getToken,
  getSession,
  removeToken,
  isAuthenticated,
  refreshSession,
};
