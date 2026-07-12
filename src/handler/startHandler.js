const axios = require('axios');
const tokenManager = require('../security/tokenManager');
const conversationState = require('../security/conversationState');
const { autoLoginByTelegramId } = require('../security/sessionHelper');
const { BACKEND_URL } = require('../config/backend');
const logger = require('../utils/logger');
const { sendMainMenu } = require('./menuHandler');

// /start command handler
const handleStart = async (bot, msg) => {
  const chatId     = msg.chat.id;
  const telegramId = msg.from.id;

  // Clear any half-finished flow so a stuck state can never trap a user.
  await conversationState.clearState(chatId);

  const existingSession = await tokenManager.getSession(telegramId);
  if (existingSession) {
    await bot.sendMessage(chatId, '✅ Welcome Back!\n\nYou are already logged in.');
    await sendMainMenu(bot, chatId);
    return;
  }

  try {
    const response = await axios.get(`${BACKEND_URL}/api/users/check/${telegramId}`);
    if (response?.data?.exists) {
      const user = response.data.user || {};
      const loginResult = await autoLoginByTelegramId(bot, chatId, telegramId);

      if (loginResult?.success) {
        await bot.sendMessage(
          chatId,
          `✅ Welcome back, *${user.username || 'there'}*!\n\nYou have been logged in automatically.`,
          { parse_mode: 'Markdown' }
        );
        await sendMainMenu(bot, chatId);
        return;
      }

      await conversationState.setState(chatId, 'AWAITING_LOGIN_PASSWORD', {
        telegramId,
        username: user.username,
      });
      await bot.sendMessage(
        chatId,
        `✅ User Found!\n\nUsername: ${user.username || 'your account'}\n\nPlease enter your password to login:`
      );
      return;
    }
  } catch (error) {
    logger.warn({ chatId, telegramId, err: error.message }, 'startHandler: registration check failed, falling back to phone prompt');
  }

  const welcomeMessage =
    '👋 Welcome to Telegram Games!\n\n' +
    'This bot allows you to play amazing games and earn rewards.\n\n' +
    'To continue, please share your phone number.';

  const opts = {
    reply_markup: {
      keyboard: [
        [{ text: '📱 Share Phone Number', request_contact: true }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    }
  };

  await bot.sendMessage(chatId, welcomeMessage, opts);
};

module.exports = { handleStart };
