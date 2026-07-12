const axios = require('axios');
require('dotenv').config();
const tokenManager = require('../security/tokenManager');
const conversationState = require('../security/conversationState');
const { requireAuth, requestReauth } = require('../security/sessionHelper');
const { validateUsername, checkPasswordStrength } = require('../utils/validation');
const { BACKEND_URL } = require('../config/backend');
const logger = require('../utils/logger');
const { buildMiniAppLaunchUrl } = require('../utils/miniAppLaunch');

const PROFILE_UPDATE_STEPS = {
  USERNAME: 'AWAITING_PROFILE_USERNAME',
  PASSWORD: 'AWAITING_PROFILE_PASSWORD',
};

const getGameIcon = (name) => {
  const n = (name || '').toLowerCase();
  if (n.includes('dama'))   return '♟️';
  if (n.includes('bingo'))  return '🎲';
  if (n.includes('ludo'))   return '🎲';
  if (n.includes('flappy')) return '🐦';
  if (n.includes('2048'))   return '🔢';
  if (n.includes('snake'))  return '🐍';
  if (n.includes('tetris')) return '🧩';
  if (n.includes('tic'))    return '⭕';
  if (n.includes('memory')) return '🧠';
  if (n.includes('quiz'))   return '❓';
  return '🎮';
};

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
    ],
  };
  await bot.sendMessage(chatId, '📋 Main Menu\n\nWhat would you like to do?', {
    reply_markup: inlineKeyboard,
  });
};

const startProfileUpdate = async (bot, chatId, telegramId, kind) => {
  const session = await tokenManager.getSession(telegramId);
  if (!session) { await requestReauth(bot, chatId); return; }

  const step = kind === 'password' ? PROFILE_UPDATE_STEPS.PASSWORD : PROFILE_UPDATE_STEPS.USERNAME;
  await conversationState.setState(chatId, step, {
    telegramId,
    userId: session.userId,
    action: kind,
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
  const chatId      = msg.chat.id;
  const telegramId  = msg.from.id;
  const newUsername = (msg.text || '').trim();

  if (!validateUsername(newUsername)) {
    await conversationState.updateState(chatId, {});
    await bot.sendMessage(chatId, '❌ Invalid username. Please try again (3-20 characters, letters/numbers/underscore only):');
    return;
  }

  const token = await tokenManager.getToken(telegramId);
  if (!token) { await conversationState.clearState(chatId); await requestReauth(bot, chatId); return; }

  try {
    await axios.put(
      `${BACKEND_URL}/api/users/${state.data.userId}/username`,
      { username: newUsername },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    await conversationState.clearState(chatId);
    await bot.sendMessage(chatId, `✅ Username updated to ${newUsername}.`);
    await showProfile(bot, chatId, telegramId);
  } catch (error) {
    logger.error({ chatId, err: error.response?.data?.error || error.message }, 'username update failed');
    await conversationState.clearState(chatId);
    await bot.sendMessage(chatId, `❌ ${error.response?.data?.error || 'Could not update username.'}`);
  }
};

const processProfilePassword = async (bot, msg, state) => {
  const chatId      = msg.chat.id;
  const telegramId  = msg.from.id;
  const newPassword = msg.text || '';

  const strengthCheck = checkPasswordStrength(newPassword);
  if (!strengthCheck.isStrong) {
    await conversationState.updateState(chatId, {});
    let feedback = '❌ Password is not strong enough!\n\n';
    strengthCheck.messages.forEach((m) => { feedback += m + '\n'; });
    feedback += '\n🔄 Please try a different password:';
    await bot.sendMessage(chatId, feedback);
    return;
  }

  const token = await tokenManager.getToken(telegramId);
  if (!token) { await conversationState.clearState(chatId); await requestReauth(bot, chatId); return; }

  try {
    await axios.put(
      `${BACKEND_URL}/api/users/${state.data.userId}/password`,
      { password: newPassword },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    await conversationState.clearState(chatId);
    await bot.sendMessage(chatId, '✅ Password updated successfully.');
    await showProfile(bot, chatId, telegramId);
  } catch (error) {
    logger.error({ chatId, err: error.response?.data?.error || error.message }, 'password update failed');
    await conversationState.clearState(chatId);
    await bot.sendMessage(chatId, `❌ ${error.response?.data?.error || 'Could not update password.'}`);
  }
};

const showGames = async (bot, chatId, telegramId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = await tokenManager.getSession(telegramId);

  try {
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

    // Fetch balance once — shared across all game buttons in this list
    let balanceRaw = 0;
    try {
      const balRes = await axios.get(
        `${BACKEND_URL}/api/users/${session.userId}/balance`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      balanceRaw = Number(balRes.data.balance?.balance ?? 0);
    } catch (balErr) {
      logger.warn({ chatId, err: balErr.message }, 'showGames: balance fetch failed, defaulting to 0');
    }

    const buildGameUrl = async (game) => {
      const baseUrl = game.mini_app_url || game.game_url;
      if (!baseUrl) return null;

      try {
        // Call the launch endpoint — backend signs phone/username/balance into
        // an encrypted launch token so they never appear raw in the URL.
        const tkRes = await axios.get(
          `${BACKEND_URL}/api/admin/games/game-tokens/launch/${game.id}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            params: {
              phone:    user?.phone_number || '',
              username: user?.username     || '',
              balance:  balanceRaw.toFixed(2),
            },
          }
        );
        const gameToken = tkRes.data.token || null;

        if (!gameToken) return null; // no token configured for this game

        return buildMiniAppLaunchUrl({
          baseUrl,
          gameToken,
          launchData: {
            phone: user?.phone_number || '',
            username: user?.username || '',
            balance: balanceRaw.toFixed(2),
          },
          secret: process.env.DAMA_LAUNCH_SECRET,
        });
      } catch {
        return null; // token/launch not configured — fall back to callback
      }
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

    // DEBUG: show the generated URLs so you can verify token+launch params
    for (let i = 0; i < games.length; i++) {
      const debugUrl = await buildGameUrl(games[i]);
      if (debugUrl) {
        await bot.sendMessage(chatId, `🔗 *[DEBUG] ${games[i].name}*\n\`${debugUrl}\``, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, `⚠️ *[DEBUG] ${games[i].name}* — no launch URL built (no token configured?)`, { parse_mode: 'Markdown' });
      }
    }

    await bot.sendMessage(chatId, '🎮 *Choose a game:*', {
      reply_markup: { inline_keyboard: rows },
      parse_mode: 'Markdown',
    });
  } catch (error) {
    logger.error({ chatId, telegramId, err: error.message }, 'showGames failed');
    if (error.response?.data?.error === 'Token expired') {
      await tokenManager.removeToken(telegramId);
      await requestReauth(bot, chatId);
    } else {
      await bot.sendMessage(chatId, '❌ Could not fetch games. Please try again.');
    }
  }
};

const showBalance = async (bot, chatId, telegramId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = await tokenManager.getSession(telegramId);

  try {
    const response = await axios.get(`${BACKEND_URL}/api/users/${session.userId}/balance`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const balance = response.data.balance;
    await bot.sendMessage(
      chatId,
      `💰 Your Balance\n\nTotal Balance: $${Number(balance.balance ?? 0).toFixed(2)}\nWithdrawable: $${Number(balance.balance ?? 0).toFixed(2)}\nNon-Withdrawable: $0.00`
    );
  } catch (error) {
    logger.error({ chatId, telegramId, err: error.message }, 'showBalance failed');
    if (error.response?.data?.error === 'Token expired') {
      await tokenManager.removeToken(telegramId);
      await requestReauth(bot, chatId);
    } else {
      await bot.sendMessage(chatId, '❌ Could not fetch balance.');
    }
  }
};

const showProfile = async (bot, chatId, telegramId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = await tokenManager.getSession(telegramId);

  try {
    const [userResponse, balanceResponse] = await Promise.all([
      axios.get(`${BACKEND_URL}/api/users/${session.userId}`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${BACKEND_URL}/api/users/${session.userId}/balance`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const user    = userResponse.data.user;
    const balance = balanceResponse.data.balance;
    const total   = Number(balance?.balance || 0);

    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: '✏️ Change Username',    callback_data: 'menu:profile:change_username' }],
        [{ text: '🔐 Change Password',    callback_data: 'menu:profile:change_password' }],
        [{ text: '📋 Check Transactions', callback_data: 'wallet:transactions' }],
      ],
    };

    await bot.sendMessage(
      chatId,
      `👤 *Your Profile*\n\n` +
      `Username: ${user.username}\n` +
      `Phone: ${user.phone_number}\n` +
      `User ID: ${user.id}\n\n` +
      `💼 *Wallet*\n` +
      `💵 Total Balance:      *$${total.toFixed(2)}*\n` +
      `✅ Withdrawable:       *$${total.toFixed(2)}*\n` +
      `🔒 Non-Withdrawable:  *$0.00*\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📊 Total:              *$${total.toFixed(2)}*`,
      { reply_markup: inlineKeyboard, parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error({ chatId, telegramId, err: error.message }, 'showProfile failed');
    if (error.response?.data?.error === 'Token expired') {
      await tokenManager.removeToken(telegramId);
      await requestReauth(bot, chatId);
    } else {
      await bot.sendMessage(chatId, '❌ Could not fetch profile.');
    }
  }
};

const logout = async (bot, chatId, telegramId) => {
  await tokenManager.removeToken(telegramId);
  await bot.sendMessage(chatId, '👋 You have been logged out.\n\nSend /start to login again.');
};

const startGame = async (bot, chatId, telegramId, gameId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = await tokenManager.getSession(telegramId);

  try {
    const [gameRes, userRes] = await Promise.all([
      axios.get(`${BACKEND_URL}/api/games/${gameId}`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${BACKEND_URL}/api/users/${session.userId}`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const game = gameRes.data.game;
    const user = userRes.data.user;

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

    await axios.post(
      `${BACKEND_URL}/api/games/${gameId}/start`,
      { user_id: session.userId },
      { headers: { Authorization: `Bearer ${token}` } }
    ).catch(() => {});

    const baseUrl = game.mini_app_url || game.game_url;
    if (baseUrl) {
      // Fetch signed launch token — backend encrypts phone/username/balance
      // so they are never exposed raw in the URL.
      let gameToken = null;
      try {
        const tkRes = await axios.get(
          `${BACKEND_URL}/api/admin/games/game-tokens/launch/${gameId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            params: {
              phone:    user?.phone_number || '',
              username: user?.username     || '',
              balance:  balanceRaw.toFixed(2),
            },
          }
        );
        gameToken = tkRes.data.token || null;
      } catch (tkErr) {
        logger.warn({ chatId, gameId, err: tkErr.message }, 'startGame: launch token fetch failed');
      }

      const launchUrl = buildMiniAppLaunchUrl({
        baseUrl,
        gameToken,
        launchData: {
          phone: user?.phone_number || '',
          username: user?.username || '',
          balance: balanceRaw.toFixed(2),
        },
        secret: process.env.DAMA_LAUNCH_SECRET,
      }) || baseUrl;

      await bot.sendMessage(
        chatId,
        `🎮 *${game.name}*\n\n` +
        `${game.description ? game.description + '\n\n' : ''}` +
        `💵 Your balance: *$${balanceRaw.toFixed(2)}*\n\n` +
        `Tap below to launch:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: `🚀 Play ${game.name}`, web_app: { url: launchUrl } }]],
          },
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

const handleMenu = async (bot, msg) => {
  const chatId     = msg.chat.id;
  const telegramId = msg.from.id;
  const session    = await tokenManager.getSession(telegramId);
  if (!session) { await requestReauth(bot, chatId); return; }
  await sendMainMenu(bot, chatId);
};

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
      if      (data === 'menu:games')   await showGames(bot, chatId, telegramId);
      else if (data === 'menu:balance') await showBalance(bot, chatId, telegramId);
      else if (data === 'menu:wallet')  await showWalletMenu(bot, chatId, telegramId);
      else if (data === 'menu:profile') await showProfile(bot, chatId, telegramId);
      else if (data === 'menu:help') {
        const { handleHelp } = require('./helpHandler');
        await handleHelp(bot, { chat: { id: chatId }, from: { id: telegramId } });
      }
      else if (data === 'menu:profile:change_username') await startProfileUpdate(bot, chatId, telegramId, 'username');
      else if (data === 'menu:profile:change_password') await startProfileUpdate(bot, chatId, telegramId, 'password');
      else if (data === 'menu:logout')       await logout(bot, chatId, telegramId);
      else if (data === 'wallet:menu')       await showWalletMenu(bot, chatId, telegramId);
      else if (data === 'wallet:deposit')    await startDeposit(bot, chatId, telegramId);
      else if (data === 'wallet:withdraw')   await startWithdraw(bot, chatId, telegramId);
      else if (data === 'wallet:transactions') await showTransactions(bot, chatId, telegramId);
      else if (data === 'wallet:check_tx')   await startCheckTransaction(bot, chatId, telegramId);
      else if (data === 'wallet:back')       await sendMainMenu(bot, chatId);
      else if (data.startsWith('wallet:dep_method:')) {
        const methodId = data.split('wallet:dep_method:')[1];
        await selectDepositMethod(bot, chatId, telegramId, methodId);
      }
      else if (data.startsWith('wallet:wd_method:')) {
        const methodId = data.split('wallet:wd_method:')[1];
        await selectWithdrawMethod(bot, chatId, telegramId, methodId);
      }
      else if (data.startsWith('start_game:')) {
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
  PROFILE_UPDATE_STEPS,
};
