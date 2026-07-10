const tokenManager = require('../security/tokenManager');
const conversationState = require('../security/conversationState');
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
