const tokenManager = require('../security/tokenManager');
const conversationState = require('../security/conversationState');
const { sendMainMenu } = require('./menuHandler');

// /start command handler
const handleStart = async (bot, msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  // Starting fresh always clears any half-finished login/registration flow
  // for this chat, so a stuck flow can never trap a user.
  conversationState.clearState(chatId);

  const existingSession = tokenManager.getSession(telegramId);
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
        [
          {
            text: '📱 Share Phone Number',
            request_contact: true
          }
        ]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };

  await bot.sendMessage(chatId, welcomeMessage, opts);
};

module.exports = { handleStart };
