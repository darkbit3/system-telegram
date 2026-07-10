const { handleStart } = require('./startHandler');
const { handleContact } = require('./contactHandler');
const { handleMenu, registerCallbackHandler } = require('./menuHandler');
const { handleHelp } = require('./helpHandler');
const { showWalletMenu, showTransactions } = require('./walletHandler');
const { requestReauth } = require('../security/sessionHelper');
const conversationState = require('../security/conversationState');
const tokenManager = require('../security/tokenManager');
const axios = require('axios');
require('dotenv').config();
const { BACKEND_URL } = require('../config/backend');
const logger = require('../utils/logger');

// Command handler
const handleCommands = (bot) => {
  bot.onText(/\/start/, (msg) => {
    handleStart(bot, msg);
  });

  bot.onText(/\/menu/, (msg) => {
    handleMenu(bot, msg);
  });

  bot.onText(/\/help/, (msg) => {
    handleHelp(bot, msg);
  });

  bot.onText(/\/wallet/, async (msg) => {
    const chatId     = msg.chat.id;
    const telegramId = msg.from.id;
    if (!tokenManager.getSession(telegramId)) {
      await requestReauth(bot, chatId);
      return;
    }
    showWalletMenu(bot, chatId, telegramId);
  });

  bot.onText(/\/balance/, async (msg) => {
    const chatId     = msg.chat.id;
    const telegramId = msg.from.id;
    const session    = tokenManager.getSession(telegramId);
    if (!session) {
      await requestReauth(bot, chatId);
      return;
    }
    const token = tokenManager.getToken(telegramId);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/users/${session.userId}/balance`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const bal = res.data.balance;
      bot.sendMessage(
        chatId,
        `💰 *Your Balance*\n\n💵 Balance: *$${Number(bal?.balance || 0).toFixed(2)}*`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ chatId, telegramId, err: err.message }, 'balance fetch failed');
      bot.sendMessage(chatId, '❌ Could not fetch balance. Please try again.');
    }
  });

  bot.onText(/\/transactions/, async (msg) => {
    const chatId     = msg.chat.id;
    const telegramId = msg.from.id;
    if (!tokenManager.getSession(telegramId)) {
      await requestReauth(bot, chatId);
      return;
    }
    showTransactions(bot, chatId, telegramId);
  });

  // Cancel any in-progress flow
  bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    conversationState.clearState(chatId);
    bot.sendMessage(chatId, '❌ Cancelled. Send /start to begin again.');
  });

  // All inline-keyboard button taps go through this single handler
  registerCallbackHandler(bot);
};

// Contact handler (phone number sharing)
const handleContacts = (bot) => {
  bot.on('contact', (msg) => {
    handleContact(bot, msg);
  });
};

module.exports = { handleCommands, handleContacts };
