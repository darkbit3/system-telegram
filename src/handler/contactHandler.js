const axios = require('axios');
require('dotenv').config();
const tokenManager = require('../security/tokenManager');
const conversationState = require('../security/conversationState');
const { autoLoginByTelegramId } = require('../security/sessionHelper');
const { checkPasswordStrength, validateUsername } = require('../utils/validation');
const { sendMainMenu } = require('./menuHandler');
const { BACKEND_URL } = require('../config/backend');
const logger = require('../utils/logger');

const STEPS = {
  LOGIN_PASSWORD: 'AWAITING_LOGIN_PASSWORD',
  REG_USERNAME:   'AWAITING_REG_USERNAME',
  REG_PASSWORD:   'AWAITING_REG_PASSWORD',
};

const tryDeleteMessage = async (bot, chatId, messageId) => {
  try { await bot.deleteMessage(chatId, messageId); } catch { /* ignore */ }
};

// Fired when a user taps "Share Phone Number".
const handleContact = async (bot, msg) => {
  const chatId      = msg.chat.id;
  const telegramId  = msg.from.id;
  const phoneNumber = msg.contact.phone_number;

  if (msg.contact.user_id && msg.contact.user_id !== telegramId) {
    bot.sendMessage(
      chatId,
      "❌ Please share your own phone number using the button below, not someone else's contact."
    );
    return;
  }

  const existingSession = await tokenManager.getSession(telegramId);
  if (existingSession) {
    await bot.sendMessage(chatId, '✅ Welcome Back!\n\nYou are already logged in.');
    await sendMainMenu(bot, chatId);
    return;
  }

  try {
    const response = await axios.get(`${BACKEND_URL}/api/users/check/${telegramId}`);

    if (response.data.exists) {
      const user = response.data.user;

      const result = await autoLoginByTelegramId(bot, chatId, telegramId);
      if (result.success) {
        await bot.sendMessage(
          chatId,
          `✅ Welcome back, *${user.username}*!\n\nYou have been logged in automatically.`,
          { parse_mode: 'Markdown' }
        );
        await sendMainMenu(bot, chatId);
        return;
      }

      // Fallback: ask for password
      await conversationState.setState(chatId, STEPS.LOGIN_PASSWORD, {
        telegramId,
        username: user.username,
      });
      await bot.sendMessage(
        chatId,
        `✅ User Found!\n\nUsername: ${user.username}\nPhone: ${phoneNumber}\n\nPlease enter your password to login:`
      );
    } else {
      await conversationState.setState(chatId, STEPS.REG_USERNAME, {
        telegramId,
        phoneNumber,
      });
      await bot.sendMessage(
        chatId,
        `👤 New User Registration\n\nPhone: ${phoneNumber}\n\nLet's create your account!`
      );
      await bot.sendMessage(
        chatId,
        '🔐 Password Requirements:\n' +
        '• Minimum 8 characters\n' +
        '• At least one UPPERCASE letter\n' +
        '• At least one lowercase letter\n' +
        '• At least one number (0-9)\n' +
        '• At least one special character (@$!%*?&)\n\n' +
        'Example: Password123!'
      );
      await bot.sendMessage(chatId, '📝 Enter your username (3-20 characters, alphanumeric and underscore):');
    }
  } catch (error) {
    const isNetworkError = !error.response;
    const statusCode     = error.response?.status;
    logger.error(
      { chatId, telegramId, network: isNetworkError, status: statusCode, err: error.message },
      'contactHandler: check user failed'
    );
    await conversationState.clearState(chatId);
    if (isNetworkError) {
      await bot.sendMessage(
        chatId,
        '⚠️ Could not connect to the server right now.\n\nPlease make sure the backend is running and try again with /start.'
      );
    } else {
      await bot.sendMessage(chatId, `❌ Server error (${statusCode}). Please try again with /start.`);
    }
  }
};

const processLoginPassword = async (bot, msg, state) => {
  const chatId   = msg.chat.id;
  const password = msg.text;
  const { telegramId, username } = state.data;

  await tryDeleteMessage(bot, chatId, msg.message_id);
  await conversationState.clearState(chatId);

  try {
    const response = await axios.post(`${BACKEND_URL}/api/users/login`, {
      telegram_id: telegramId,
      username,
      password,
    });

    if (response.data.success) {
      await tokenManager.storeToken(telegramId, response.data.token, response.data.userId);
      await bot.sendMessage(chatId, `✅ Welcome back, ${username}!\n\nYou are now logged in.`);
      await sendMainMenu(bot, chatId);
    }
  } catch (error) {
    logger.error({ chatId, err: error.response?.data?.error || error.message }, 'login failed');
    bot.sendMessage(
      chatId,
      `❌ Login failed: ${error.response?.data?.error || 'Invalid credentials'}\n\nSend /start to try again.`
    );
  }
};

const processRegUsername = async (bot, msg, state) => {
  const chatId   = msg.chat.id;
  const username = (msg.text || '').trim();
  const { telegramId, phoneNumber } = state.data;

  if (!validateUsername(username)) {
    await conversationState.updateState(chatId, {});
    bot.sendMessage(
      chatId,
      '❌ Invalid username. It must be 3-20 characters, letters/numbers/underscore only. Try again:'
    );
    return;
  }

  await conversationState.setState(chatId, STEPS.REG_PASSWORD, { telegramId, phoneNumber, username });
  bot.sendMessage(chatId, '🔐 Enter your password:');
};

const processRegPassword = async (bot, msg, state) => {
  const chatId   = msg.chat.id;
  const password = msg.text;
  const { telegramId, phoneNumber, username } = state.data;

  await tryDeleteMessage(bot, chatId, msg.message_id);

  const strengthCheck = checkPasswordStrength(password);
  if (!strengthCheck.isStrong) {
    await conversationState.updateState(chatId, {});
    let feedback = '❌ Password is not strong enough!\n\n';
    strengthCheck.messages.forEach((m) => { feedback += m + '\n'; });
    feedback += '\n🔄 Please try a different password:';
    bot.sendMessage(chatId, feedback);
    return;
  }

  await conversationState.clearState(chatId);

  try {
    const response = await axios.post(`${BACKEND_URL}/api/users/register`, {
      telegram_id:   telegramId,
      phone_number:  phoneNumber,
      username,
      password,
    });

    if (response.data.success) {
      await tokenManager.storeToken(telegramId, response.data.token, response.data.userId);
      await bot.sendMessage(
        chatId,
        `✅ Registration Successful!\n\nWelcome ${username}! You can now enjoy our games.`
      );
      await sendMainMenu(bot, chatId);
    }
  } catch (error) {
    logger.error({ chatId, err: error.response?.data?.error || error.message }, 'registration failed');
    bot.sendMessage(
      chatId,
      `❌ Registration failed: ${error.response?.data?.error || 'Please try again'}\n\nSend /start to try again.`
    );
  }
};

module.exports = {
  handleContact,
  processLoginPassword,
  processRegUsername,
  processRegPassword,
  STEPS,
};
