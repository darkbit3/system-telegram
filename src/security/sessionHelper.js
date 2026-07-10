/**
 * sessionHelper.js
 *
 * When a session is missing or expired, instead of telling the user
 * "send /start to login again", we silently request their phone number.
 * When they share it, handleContact detects they already exist and calls
 * autoLoginByTelegramId — no password needed for re-auth.
 *
 * tokenManager methods are now async (backend-backed); all callers here
 * await them accordingly.
 */

const axios = require('axios');
require('dotenv').config();
const tokenManager = require('./tokenManager');
const { BACKEND_URL } = require('../config/backend');
const logger = require('../utils/logger');

/**
 * Silently request phone number for re-authentication.
 */
const requestReauth = async (bot, chatId) => {
  await bot.sendMessage(
    chatId,
    '🔄 Your session has expired. Please share your phone number to continue automatically.',
    {
      reply_markup: {
        keyboard: [
          [{ text: '📱 Share Phone Number', request_contact: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      }
    }
  );
};

/**
 * Auto-login a user by telegram_id only — no password.
 * Used when re-authenticating an existing user after session expiry.
 * Returns { success: true, username } or { success: false, notFound? }.
 */
const autoLoginByTelegramId = async (bot, chatId, telegramId) => {
  try {
    const res = await axios.post(`${BACKEND_URL}/api/users/auto-login`, {
      telegram_id: String(telegramId),
    });

    if (res.data.success) {
      await tokenManager.storeToken(telegramId, res.data.token, res.data.userId);
      return { success: true, username: res.data.username };
    }
    return { success: false };
  } catch (err) {
    logger.error(
      { telegramId, err: err.response?.data?.error || err.message },
      'auto-login failed'
    );
    return { success: false, notFound: err.response?.status === 404 };
  }
};

/**
 * requireAuth — returns the token if the session is valid, otherwise
 * triggers silent phone re-auth and returns null.
 */
const requireAuth = async (bot, chatId, telegramId) => {
  const token = await tokenManager.getToken(telegramId);
  if (token) return token;

  await requestReauth(bot, chatId);
  return null;
};

module.exports = { requestReauth, autoLoginByTelegramId, requireAuth };
