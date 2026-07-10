const tokenManager = require('../security/tokenManager');

const handleHelp = async (bot, msg) => {
  const chatId    = msg.chat.id;
  const telegramId = msg.from.id;
  const isLoggedIn = !!tokenManager.getSession(telegramId);

  const text =
    `ℹ️ *Help — Telegram Games Bot*\n\n` +
    `*Commands:*\n` +
    `/start — Start the bot / Login\n` +
    `/menu — Open main menu\n` +
    `/wallet — Open your wallet\n` +
    `/balance — Check your balance\n` +
    `/transactions — View last 10 transactions\n` +
    `/help — Show this help message\n` +
    `/cancel — Cancel current action\n\n` +
    `*Menu Options:*\n` +
    `🎮 View Games — Browse and launch games\n` +
    `💰 Check Balance — See your current balance\n` +
    `💼 Wallet — Deposit, withdraw & transactions\n` +
    `👤 Profile — View and edit your profile\n` +
    `🚪 Logout — End your session\n\n` +
    `*Wallet:*\n` +
    `• Deposit funds to your account\n` +
    `• Withdraw your balance\n` +
    `• View full transaction history\n\n` +
    (isLoggedIn
      ? `✅ You are currently *logged in*.\n\nUse /menu to get started.`
      : `🔐 You are *not logged in*.\n\nSend /start to login.`);

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
};

module.exports = { handleHelp };
