const axios = require('axios');
require('dotenv').config();
const tokenManager = require('../security/tokenManager');
const conversationState = require('../security/conversationState');
const { requireAuth, requestReauth } = require('../security/sessionHelper');
const { validateUsername, checkPasswordStrength } = require('../utils/validation');
const { BACKEND_URL } = require('../config/backend');
const logger = require('../utils/logger');

const PROFILE_UPDATE_STEPS = {
  USERNAME: 'AWAITING_PROFILE_USERNAME',
  PASSWORD: 'AWAITING_PROFILE_PASSWORD'
};

const getGameIcon = (name) => {
  const normalized = (name || '').toLowerCase();
  if (normalized.includes('dama')) return '♟️';
  if (normalized.includes('bingo')) return '🎲';
  if (normalized.includes('ludo')) return '🎲';
  if (normalized.includes('flappy')) return '🐦';
  if (normalized.includes('2048')) return '🔢';
  if (normalized.includes('snake')) return '🐍';
  if (normalized.includes('tetris')) return '🧩';
  if (normalized.includes('tic')) return '⭕';
  if (normalized.includes('memory')) return '🧠';
  if (normalized.includes('quiz')) return '❓';
  return '🎮';
};

// The single, canonical main menu. Everything is driven by callback_query
// (inline keyboard button taps), which Telegram always scopes to the correct
// chat/user - unlike the old bot.once('message') pattern, there is no way
// for one user's tap to be misrouted to another user's conversation.
const sendMainMenu = async (bot, chatId) => {
  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🎮 View Games',    callback_data: 'menu:games' },
        { text: '💼 Wallet',        callback_data: 'menu:wallet' },
      ],
      [
        { text: '💰 Check Balance', callback_data: 'menu:balance' },
        { text: '👤 Profile',       callback_data: 'menu:profile' },
      ],
      [
        { text: '❓ Help',          callback_data: 'menu:help' },
        { text: '🚪 Logout',        callback_data: 'menu:logout' },
      ],
    ]
  };

  await bot.sendMessage(chatId, '📋 Main Menu\n\nWhat would you like to do?', {
    reply_markup: inlineKeyboard
  });
};

const startProfileUpdate = async (bot, chatId, telegramId, kind) => {
  const session = tokenManager.getSession(telegramId);
  if (!session) {
    await requestReauth(bot, chatId);
    return;
  }

  conversationState.setState(chatId, kind === 'password' ? PROFILE_UPDATE_STEPS.PASSWORD : PROFILE_UPDATE_STEPS.USERNAME, {
    telegramId,
    userId: session.userId,
    action: kind
  });

  if (kind === 'password') {
    await bot.sendMessage(
      chatId,
      '🔐 Send your new password.\n\nRequirements:\n• Minimum 8 characters\n• At least one uppercase letter\n• At least one lowercase letter\n• At least one number\n• At least one special character (@$!%*?&)' 
    );
  } else {
    await bot.sendMessage(chatId, '✏️ Send your new username (3-20 characters, letters/numbers/underscore only):');
  }
};

const processProfileUsername = async (bot, msg, state) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const newUsername = (msg.text || '').trim();

  if (!validateUsername(newUsername)) {
    conversationState.updateState(chatId, {});
    await bot.sendMessage(chatId, '❌ Invalid username. Please try again (3-20 characters, letters/numbers/underscore only):');
    return;
  }

  const token = tokenManager.getToken(telegramId);
  if (!token) {
    conversationState.clearState(chatId);
    await requestReauth(bot, chatId);
    return;
  }

  try {
    await axios.put(
      `${BACKEND_URL}/api/users/${state.data.userId}/username`,
      { username: newUsername },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    conversationState.clearState(chatId);
    await bot.sendMessage(chatId, `✅ Username updated to ${newUsername}.`);
    await showProfile(bot, chatId, telegramId);
  } catch (error) {
    logger.error({ chatId, err: error.response?.data?.error || error.message }, 'username update failed');
    conversationState.clearState(chatId);
    await bot.sendMessage(chatId, `❌ ${error.response?.data?.error || 'Could not update username.'}`);
  }
};

const processProfilePassword = async (bot, msg, state) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const newPassword = msg.text || '';

  const strengthCheck = checkPasswordStrength(newPassword);
  if (!strengthCheck.isStrong) {
    conversationState.updateState(chatId, {});
    let feedback = '❌ Password is not strong enough!\n\n';
    strengthCheck.messages.forEach((message) => {
      feedback += message + '\n';
    });
    feedback += '\n🔄 Please try a different password:';
    await bot.sendMessage(chatId, feedback);
    return;
  }

  const token = tokenManager.getToken(telegramId);
  if (!token) {
    conversationState.clearState(chatId);
    await requestReauth(bot, chatId);
    return;
  }

  try {
    await axios.put(
      `${BACKEND_URL}/api/users/${state.data.userId}/password`,
      { password: newPassword },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    conversationState.clearState(chatId);
    await bot.sendMessage(chatId, '✅ Password updated successfully.');
    await showProfile(bot, chatId, telegramId);
  } catch (error) {
    logger.error({ chatId, err: error.response?.data?.error || error.message }, 'password update failed');
    conversationState.clearState(chatId);
    await bot.sendMessage(chatId, `❌ ${error.response?.data?.error || 'Could not update password.'}`);
  }
};

const showGames = async (bot, chatId, telegramId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = tokenManager.getSession(telegramId);

  try {
    // Fetch games and user info
    const [gamesRes, userRes] = await Promise.all([
      axios.get(`${BACKEND_URL}/api/games`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${BACKEND_URL}/api/users/${session.userId}`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const games = gamesRes.data.games || [];
    const user  = userRes.data.user;

    if (games.length === 0) {
      await bot.sendMessage(chatId, '❌ No games available at the moment.');
      return;
    }

    // Fetch fresh balance right now (single call, shared across all buttons)
    let balanceRaw = 0;
    try {
      const balRes = await axios.get(
        `${BACKEND_URL}/api/users/${session.userId}/balance`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      balanceRaw = Number(balRes.data.balance?.balance ?? 0);
    } catch (balErr) {
      logger.warn({ chatId, err: balErr.message }, 'showGames: balance fetch failed, defaulting to 0');
      balanceRaw = 0;
    }

    // Build a game launch URL with player params
    const buildGameUrl = async (game) => {
      const baseUrl = game.mini_app_url || game.game_url;
      if (!baseUrl) return null;

      // Get active game token (optional)
      let gameToken = null;
      try {
        const tkRes = await axios.get(
          `${BACKEND_URL}/api/admin/games/game-tokens/active/${game.id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        gameToken = tkRes.data.token || null;
      } catch { /* no token configured — that's fine */ }

      const params = new URLSearchParams();
      if (gameToken) params.set('token', gameToken);
      params.set('phone',    user?.phone_number || '');

      const sep = baseUrl.includes('?') ? '&' : '?';
      return baseUrl + sep + params.toString();
    };

    const rows = [];
    for (let i = 0; i < games.length; i += 2) {
      const row = [];
      for (const game of [games[i], games[i + 1]].filter(Boolean)) {
        const launchUrl = await buildGameUrl(game);
        row.push(
          launchUrl
            ? { text: `${getGameIcon(game.name)} ${game.name}`, web_app: { url: launchUrl } }
            : { text: `${getGameIcon(game.name)} ${game.name}`, callback_data: `start_game:${game.id}` }
        );
      }
      rows.push(row);
    }

    await bot.sendMessage(chatId, '🎮 *Choose a game:*', {
      reply_markup: { inline_keyboard: rows },
      parse_mode: 'Markdown',
    });
  } catch (error) {
    logger.error({ chatId, telegramId, err: error.message }, 'showGames failed');
    if (error.response?.data?.error === 'Token expired') {
      tokenManager.removeToken(telegramId);
      await requestReauth(bot, chatId);
    } else {
      await bot.sendMessage(chatId, '❌ Could not fetch games. Please try again.');
    }
  }
};

const showBalance = async (bot, chatId, telegramId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = tokenManager.getSession(telegramId);

  try {
    const response = await axios.get(`${BACKEND_URL}/api/users/${session.userId}/balance`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const balance = response.data.balance;

    await bot.sendMessage(
      chatId,
      `💰 Your Balance\n\nTotal Balance: $${Number(balance.balance ?? 0).toFixed(2)}\nWithdrawable: $${Number(balance.balance ?? 0).toFixed(2)}\nNon-Withdrawable: $0.00`
    );
  } catch (error) {
    logger.error({ chatId, telegramId, err: error.message }, 'showBalance failed');
    if (error.response?.data?.error === 'Token expired') {
      tokenManager.removeToken(telegramId);
      await requestReauth(bot, chatId);
    } else {
      await bot.sendMessage(chatId, '❌ Could not fetch balance.');
    }
  }
};

const showProfile = async (bot, chatId, telegramId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = tokenManager.getSession(telegramId);

  try {
    const [userResponse, balanceResponse] = await Promise.all([
      axios.get(`${BACKEND_URL}/api/users/${session.userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      axios.get(`${BACKEND_URL}/api/users/${session.userId}/balance`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    ]);

    const user = userResponse.data.user;
    const balance = balanceResponse.data.balance;
    const total       = Number(balance?.balance || 0);
    const withdrawable = total;
    const nonWithdraw  = 0;

    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: '✏️ Change Username', callback_data: 'menu:profile:change_username' }],
        [{ text: '🔐 Change Password', callback_data: 'menu:profile:change_password' }],
        [{ text: '📋 Check Transactions', callback_data: 'wallet:transactions' }]
      ]
    };

    await bot.sendMessage(
      chatId,
      `👤 *Your Profile*\n\n` +
      `Username: ${user.username}\n` +
      `Phone: ${user.phone_number}\n` +
      `User ID: ${user.id}\n\n` +
      `💼 *Wallet*\n` +
      `💵 Total Balance:      *$${total.toFixed(2)}*\n` +
      `✅ Withdrawable:       *$${withdrawable.toFixed(2)}*\n` +
      `🔒 Non-Withdrawable:  *$${nonWithdraw.toFixed(2)}*\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📊 Total:              *$${total.toFixed(2)}*`,
      { reply_markup: inlineKeyboard, parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error({ chatId, telegramId, err: error.message }, 'showProfile failed');
    if (error.response?.data?.error === 'Token expired') {
      tokenManager.removeToken(telegramId);
      await requestReauth(bot, chatId);
    } else {
      await bot.sendMessage(chatId, '❌ Could not fetch profile.');
    }
  }
};

const logout = async (bot, chatId, telegramId) => {
  tokenManager.removeToken(telegramId);
  await bot.sendMessage(chatId, '👋 You have been logged out.\n\nSend /start to login again.');
};

const startGame = async (bot, chatId, telegramId, gameId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = tokenManager.getSession(telegramId);

  try {
    // Fetch everything in parallel
    const [gameRes, userRes, tkRes] = await Promise.all([
      axios.get(`${BACKEND_URL}/api/games/${gameId}`,
        { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${BACKEND_URL}/api/users/${session.userId}`,
        { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${BACKEND_URL}/api/admin/games/game-tokens/active/${gameId}`,
        { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: { token: null } })),
    ]);

    const game      = gameRes.data.game;
    const user      = userRes.data.user;
    const gameToken = tkRes.data.token || null;

    // Fetch balance separately — always returns a value now
    let balanceRaw = 0;
    try {
      const balRes = await axios.get(
        `${BACKEND_URL}/api/users/${session.userId}/balance`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      balanceRaw = Number(balRes.data.balance?.balance ?? 0);
    } catch (balErr) {
      logger.warn({ chatId, err: balErr.message }, 'startGame: balance fetch failed');
    }

    // Record game session start
    await axios.post(
      `${BACKEND_URL}/api/games/${gameId}/start`,
      { user_id: session.userId },
      { headers: { Authorization: `Bearer ${token}` } }
    ).catch(() => {}); // non-fatal

    // Build launch URL
    const baseUrl = game.mini_app_url || game.game_url;
    if (baseUrl) {
      const params = new URLSearchParams();
      if (gameToken) params.set('token', gameToken);
      params.set('phone',    user?.phone_number || '');
      params.set('username', user?.username     || '');
      params.set('balance',  balanceRaw.toFixed(2));

      const sep = baseUrl.includes('?') ? '&' : '?';
      const launchUrl = baseUrl + sep + params.toString();

      await bot.sendMessage(
        chatId,
        `🎮 *${game.name}*\n\n` +
        `${game.description ? game.description + '\n\n' : ''}` +
        `💵 Your balance: *$${balanceRaw.toFixed(2)}*\n\n` +
        `Tap below to launch:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: `🚀 Play ${game.name}`, web_app: { url: launchUrl } }
            ]]
          }
        }
      );
    } else {
      await bot.sendMessage(
        chatId,
        `🎮 *${game.name}*\n\n${game.description || 'No description available'}\n\n⚠️ No URL configured for this game yet.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    logger.error({ chatId, telegramId, err: error.response?.data?.error || error.message }, 'startGame failed');
    await bot.sendMessage(chatId, '❌ Could not start game. Please try again.');
  }
};

// /menu command handler
const handleMenu = async (bot, msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  const session = tokenManager.getSession(telegramId);
  if (!session) {
    await requestReauth(bot, chatId);
    return;
  }

  await sendMainMenu(bot, chatId);
};

// Single, centralized callback_query handler for every inline-keyboard
// button in the bot (main menu + game selection). Telegram always tells us
// exactly which chat/user triggered a callback_query, so routing everything
// through one handler keyed off query.from.id / query.message.chat.id is
// inherently safe for concurrent users - unlike the old per-flow
// bot.once('message') listeners.
const registerCallbackHandler = (bot) => {
  const {
    showWalletMenu,
    startDeposit,
    startWithdraw,
    startCheckTransaction,
    showTransactions,
    selectDepositMethod,
    selectWithdrawMethod,
  } = require('./walletHandler');

  bot.on('callback_query', async (query) => {
    const chatId     = query.message.chat.id;
    const telegramId = query.from.id;
    const data       = query.data || '';

    try {
      if (data === 'menu:games') {
        await showGames(bot, chatId, telegramId);
      } else if (data === 'menu:balance') {
        await showBalance(bot, chatId, telegramId);
      } else if (data === 'menu:wallet') {
        await showWalletMenu(bot, chatId, telegramId);
      } else if (data === 'menu:profile') {
        await showProfile(bot, chatId, telegramId);
      } else if (data === 'menu:help') {
        const { handleHelp } = require('./helpHandler');
        await handleHelp(bot, { chat: { id: chatId }, from: { id: telegramId } });
      } else if (data === 'menu:profile:change_username') {
        await startProfileUpdate(bot, chatId, telegramId, 'username');
      } else if (data === 'menu:profile:change_password') {
        await startProfileUpdate(bot, chatId, telegramId, 'password');
      } else if (data === 'menu:logout') {
        await logout(bot, chatId, telegramId);

      // Wallet top-level
      } else if (data === 'wallet:menu') {
        await showWalletMenu(bot, chatId, telegramId);
      } else if (data === 'wallet:deposit') {
        await startDeposit(bot, chatId, telegramId);
      } else if (data === 'wallet:withdraw') {
        await startWithdraw(bot, chatId, telegramId);
      } else if (data === 'wallet:transactions') {
        await showTransactions(bot, chatId, telegramId);
      } else if (data === 'wallet:check_tx') {
        await startCheckTransaction(bot, chatId, telegramId);
      } else if (data === 'wallet:back') {
        await sendMainMenu(bot, chatId);

      // Deposit method selected
      } else if (data.startsWith('wallet:dep_method:')) {
        const methodId = data.split('wallet:dep_method:')[1];
        await selectDepositMethod(bot, chatId, telegramId, methodId);

      // Withdraw method selected
      } else if (data.startsWith('wallet:wd_method:')) {
        const methodId = data.split('wallet:wd_method:')[1];
        await selectWithdrawMethod(bot, chatId, telegramId, methodId);

      } else if (data.startsWith('start_game:')) {
        const gameId = data.split(':')[1];
        await startGame(bot, chatId, telegramId, gameId);
      }
      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      logger.error({ chatId, telegramId, err: error.message }, 'callback_query handler failed');
      try {
        await bot.answerCallbackQuery(query.id, { text: '❌ Something went wrong', show_alert: true });
      } catch (_) {}
    }
  });
};

module.exports = {
  handleMenu,
  sendMainMenu,
  registerCallbackHandler,
  processProfileUsername,
  processProfilePassword,
  PROFILE_UPDATE_STEPS
};
