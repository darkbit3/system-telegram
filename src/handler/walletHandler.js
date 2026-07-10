const axios = require('axios');
require('dotenv').config();
const tokenManager = require('../security/tokenManager');
const conversationState = require('../security/conversationState');
const { requireAuth } = require('../security/sessionHelper');
const { BACKEND_URL } = require('../config/backend');
const logger = require('../utils/logger');

const DEPOSIT_METHODS = [
  { id: 'telebirr',  label: '📱 TeleBirr',   info: 'TeleBirr Account: *0911000000*\nName: *TG Games*' },
  { id: 'cbe',       label: '🏦 CBE',         info: 'CBE Account: *1000123456789*\nName: *TG Games Ltd*' },
  { id: 'cbebirr',   label: '💳 CBE Birr',    info: 'CBE Birr Number: *0911000001*\nName: *TG Games*' },
  { id: 'abyssinia', label: '🏦 Abyssinia',   info: 'Abyssinia Account: *46008765432*\nName: *TG Games Ltd*' },
  { id: 'dashen',    label: '🏦 Dashen',      info: 'Dashen Account: *0020184321001*\nName: *TG Games Ltd*' },
  { id: 'abay',      label: '🏦 Abay Bank',   info: 'Abay Account: *38001234567*\nName: *TG Games Ltd*' },
  { id: 'mpesa',     label: '📲 M-PESA',      info: 'M-PESA Number: *0712000000*\nName: *TG Games*' },
];

const WITHDRAW_METHODS = [
  { id: 'telebirr',  label: '📱 TeleBirr' },
  { id: 'cbe',       label: '🏦 CBE' },
  { id: 'cbebirr',   label: '💳 CBE Birr' },
  { id: 'abyssinia', label: '🏦 Abyssinia' },
  { id: 'dashen',    label: '🏦 Dashen' },
  { id: 'abay',      label: '🏦 Abay Bank' },
  { id: 'mpesa',     label: '📲 M-PESA' },
];

const WALLET_STEPS = {
  DEPOSIT_AMOUNT:  'AWAITING_DEPOSIT_AMOUNT',
  DEPOSIT_TX_NUM:  'AWAITING_DEPOSIT_TX_NUM',
  WITHDRAW_AMOUNT: 'AWAITING_WITHDRAW_AMOUNT',
  WITHDRAW_ACCT:   'AWAITING_WITHDRAW_ACCT',
  CHECK_TX_REF:    'AWAITING_CHECK_TX_REF',
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const statusEmoji = (s) => {
  if (s === 'done')     return '✅ Done';
  if (s === 'rejected') return '❌ Rejected';
  return '⏳ Pending';
};

const generateTxId = () => {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `TXN-${ts}-${rand}`;
};

// ── Wallet main menu ──────────────────────────────────────────────────────────
const showWalletMenu = async (bot, chatId, telegramId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = await tokenManager.getSession(telegramId);

  try {
    const res = await axios.get(`${BACKEND_URL}/api/users/${session.userId}/balance`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const bal   = res.data.balance;
    const total = Number(bal?.balance || 0);

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '💰 Deposit',          callback_data: 'wallet:deposit' },
          { text: '💸 Withdraw',         callback_data: 'wallet:withdraw' },
        ],
        [{ text: '📋 Transactions',      callback_data: 'wallet:transactions' }],
        [{ text: '🔍 Check Transaction', callback_data: 'wallet:check_tx' }],
        [{ text: '🔙 Main Menu',         callback_data: 'wallet:back' }],
      ],
    };

    await bot.sendMessage(
      chatId,
      `💼 *Wallet*\n\n` +
      `💵 Total Balance:      *$${total.toFixed(2)}*\n` +
      `✅ Withdrawable:       *$${total.toFixed(2)}*\n` +
      `🔒 Non-Withdrawable:  *$0.00*\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📊 Total:              *$${total.toFixed(2)}*\n\n` +
      `Choose an action:`,
      { reply_markup: inlineKeyboard, parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error({ chatId, err: err.message }, 'wallet menu failed');
    await bot.sendMessage(chatId, '❌ Could not load wallet. Please try again.');
  }
};

// ── DEPOSIT: Step 1 — choose method ──────────────────────────────────────────
const startDeposit = async (bot, chatId, telegramId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;

  const rows = [];
  for (let i = 0; i < DEPOSIT_METHODS.length; i += 2) {
    const row = [{ text: DEPOSIT_METHODS[i].label, callback_data: `wallet:dep_method:${DEPOSIT_METHODS[i].id}` }];
    if (DEPOSIT_METHODS[i + 1]) {
      row.push({ text: DEPOSIT_METHODS[i + 1].label, callback_data: `wallet:dep_method:${DEPOSIT_METHODS[i + 1].id}` });
    }
    rows.push(row);
  }
  rows.push([{ text: '🔙 Back', callback_data: 'wallet:menu' }]);

  await bot.sendMessage(
    chatId,
    `💰 *Deposit — Choose Payment Method*\n\nSelect how you want to deposit funds:`,
    { reply_markup: { inline_keyboard: rows }, parse_mode: 'Markdown' }
  );
};

// ── DEPOSIT: Step 2 — show bank info, ask amount ──────────────────────────────
const selectDepositMethod = async (bot, chatId, telegramId, methodId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = await tokenManager.getSession(telegramId);

  const method = DEPOSIT_METHODS.find(m => m.id === methodId);
  if (!method) { await bot.sendMessage(chatId, '❌ Invalid method. Please try again.'); return; }

  await conversationState.setState(chatId, WALLET_STEPS.DEPOSIT_AMOUNT, {
    telegramId,
    userId:      session.userId,
    method:      method.id,
    methodLabel: method.label,
  });

  await bot.sendMessage(
    chatId,
    `💰 *Deposit via ${method.label}*\n\n` +
    `📋 *Payment Details:*\n${method.info}\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `Please send the payment to the account above, then enter the *amount* you deposited:\n\n` +
    `Send /cancel to abort.`,
    { parse_mode: 'Markdown' }
  );
};

// ── DEPOSIT: Step 3 — got amount, ask bank transaction number ─────────────────
const processDepositAmount = async (bot, msg, state) => {
  const chatId = msg.chat.id;
  const amount = parseFloat((msg.text || '').trim());

  if (isNaN(amount) || amount <= 0) {
    await conversationState.updateState(chatId, {});
    await bot.sendMessage(chatId, '❌ Invalid amount. Please enter a positive number (e.g. `100`):', { parse_mode: 'Markdown' });
    return;
  }

  await conversationState.setState(chatId, WALLET_STEPS.DEPOSIT_TX_NUM, { ...state.data, amount });

  await bot.sendMessage(
    chatId,
    `✅ Amount: *$${amount.toFixed(2)}*\n\n` +
    `📝 Enter the *Transaction Number* from your ${state.data.methodLabel} payment receipt:\n` +
    `_(The reference number shown after you sent the payment)_\n\n` +
    `Send /cancel to abort.`,
    { parse_mode: 'Markdown' }
  );
};

// ── DEPOSIT: Step 4 — got bank TX number, submit ──────────────────────────────
const processDepositTxNum = async (bot, msg, state) => {
  const chatId     = msg.chat.id;
  const telegramId = msg.from.id;
  const txNumber   = (msg.text || '').trim();

  if (!txNumber) {
    await conversationState.updateState(chatId, {});
    await bot.sendMessage(chatId, '❌ Please enter the transaction number from your receipt:');
    return;
  }

  await conversationState.clearState(chatId);

  const token = await tokenManager.getToken(telegramId);
  if (!token) { await requireAuth(bot, chatId, telegramId); return; }

  const systemTxId = generateTxId();

  try {
    await axios.post(
      `${BACKEND_URL}/api/admin/games/users/${state.data.userId}/request-deposit`,
      {
        amount:             state.data.amount,
        method:             state.data.method,
        transaction_id:     systemTxId,
        transaction_number: txNumber,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    await bot.sendMessage(
      chatId,
      `🎉 *Deposit Request Submitted!*\n\n` +
      `💵 Amount:          *$${state.data.amount.toFixed(2)}*\n` +
      `💳 Method:          *${state.data.methodLabel}*\n` +
      `🔢 TX Number:       \`${txNumber}\`\n` +
      `🆔 TX ID:           \`${systemTxId}\`\n` +
      `📌 Status:          *⏳ Pending*\n\n` +
      `📋 *Save your TX ID — use it to check status.*\n` +
      `Admin will confirm your deposit shortly.`,
      { parse_mode: 'Markdown' }
    );
    await showWalletMenu(bot, chatId, telegramId);
  } catch (err) {
    logger.error({ chatId, err: err.message }, 'deposit submission failed');
    await bot.sendMessage(chatId, `❌ Failed to submit: ${err.response?.data?.error || 'Please try again.'}`);
  }
};

// ── WITHDRAW: Step 1 — choose method ─────────────────────────────────────────
const startWithdraw = async (bot, chatId, telegramId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;

  const rows = [];
  for (let i = 0; i < WITHDRAW_METHODS.length; i += 2) {
    const row = [{ text: WITHDRAW_METHODS[i].label, callback_data: `wallet:wd_method:${WITHDRAW_METHODS[i].id}` }];
    if (WITHDRAW_METHODS[i + 1]) {
      row.push({ text: WITHDRAW_METHODS[i + 1].label, callback_data: `wallet:wd_method:${WITHDRAW_METHODS[i + 1].id}` });
    }
    rows.push(row);
  }
  rows.push([{ text: '🔙 Back', callback_data: 'wallet:menu' }]);

  await bot.sendMessage(
    chatId,
    `💸 *Withdraw — Choose Payment Method*\n\nSelect where you want to receive funds:`,
    { reply_markup: { inline_keyboard: rows }, parse_mode: 'Markdown' }
  );
};

// ── WITHDRAW: Step 2 — ask amount ─────────────────────────────────────────────
const selectWithdrawMethod = async (bot, chatId, telegramId, methodId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = await tokenManager.getSession(telegramId);

  const method = WITHDRAW_METHODS.find(m => m.id === methodId);
  if (!method) { await bot.sendMessage(chatId, '❌ Invalid method. Please try again.'); return; }

  try {
    const res = await axios.get(`${BACKEND_URL}/api/users/${session.userId}/balance`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const currentBalance = Number(res.data.balance?.balance || 0);

    await conversationState.setState(chatId, WALLET_STEPS.WITHDRAW_AMOUNT, {
      telegramId,
      userId:       session.userId,
      method:       method.id,
      methodLabel:  method.label,
      currentBalance,
    });

    await bot.sendMessage(
      chatId,
      `💸 *Withdraw via ${method.label}*\n\n` +
      `💵 Available Balance: *$${currentBalance.toFixed(2)}*\n\n` +
      `Enter the *amount* you want to withdraw:\n\n` +
      `Send /cancel to abort.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error({ chatId, err: err.message }, 'withdraw method selection failed');
    await bot.sendMessage(chatId, '❌ Could not load balance. Please try again.');
  }
};

// ── WITHDRAW: Step 3 — got amount, ask account number ────────────────────────
const processWithdrawAmount = async (bot, msg, state) => {
  const chatId = msg.chat.id;
  const amount = parseFloat((msg.text || '').trim());

  if (isNaN(amount) || amount <= 0) {
    await conversationState.updateState(chatId, {});
    await bot.sendMessage(chatId, '❌ Invalid amount. Enter a positive number:');
    return;
  }

  if (amount > state.data.currentBalance) {
    await conversationState.updateState(chatId, {});
    await bot.sendMessage(
      chatId,
      `❌ Insufficient balance.\n\nAvailable: *$${state.data.currentBalance.toFixed(2)}*\nRequested: *$${amount.toFixed(2)}*\n\nEnter a smaller amount:`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await conversationState.setState(chatId, WALLET_STEPS.WITHDRAW_ACCT, { ...state.data, amount });

  await bot.sendMessage(
    chatId,
    `✅ Amount: *$${amount.toFixed(2)}*\n\n` +
    `📝 Enter your *${state.data.methodLabel} account number / phone* to receive funds:\n\n` +
    `Send /cancel to abort.`,
    { parse_mode: 'Markdown' }
  );
};

// ── WITHDRAW: Step 4 — got account, submit ────────────────────────────────────
const processWithdrawAcct = async (bot, msg, state) => {
  const chatId     = msg.chat.id;
  const telegramId = msg.from.id;
  const acct       = (msg.text || '').trim();

  if (!acct) {
    await conversationState.updateState(chatId, {});
    await bot.sendMessage(chatId, '❌ Please enter a valid account number:');
    return;
  }

  await conversationState.clearState(chatId);

  const token = await tokenManager.getToken(telegramId);
  if (!token) { await requireAuth(bot, chatId, telegramId); return; }

  const systemTxId = generateTxId();

  try {
    await axios.post(
      `${BACKEND_URL}/api/admin/games/users/${state.data.userId}/request-withdraw`,
      {
        amount:             state.data.amount,
        method:             state.data.method,
        transaction_id:     systemTxId,
        transaction_number: acct,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    await bot.sendMessage(
      chatId,
      `🎉 *Withdraw Request Submitted!*\n\n` +
      `💵 Amount:          *$${state.data.amount.toFixed(2)}*\n` +
      `💳 Method:          *${state.data.methodLabel}*\n` +
      `📲 Account:         \`${acct}\`\n` +
      `🆔 TX ID:           \`${systemTxId}\`\n` +
      `📌 Status:          *⏳ Pending*\n\n` +
      `📋 *Save your TX ID — use it to check status.*\n` +
      `Admin will process your withdraw shortly.`,
      { parse_mode: 'Markdown' }
    );
    await showWalletMenu(bot, chatId, telegramId);
  } catch (err) {
    logger.error({ chatId, err: err.response?.data?.error || err.message }, 'withdraw submission failed');
    await bot.sendMessage(chatId, `❌ Failed to submit: ${err.response?.data?.error || 'Please try again.'}`);
  }
};

// ── CHECK TRANSACTION: Step 1 — ask ref ──────────────────────────────────────
const startCheckTransaction = async (bot, chatId, telegramId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = await tokenManager.getSession(telegramId);

  await conversationState.setState(chatId, WALLET_STEPS.CHECK_TX_REF, {
    telegramId,
    userId: session.userId,
  });

  await bot.sendMessage(
    chatId,
    `🔍 *Check Transaction*\n\n` +
    `Enter your *Transaction ID / Reference number*:\n\n` +
    `Send /cancel to abort.`,
    { parse_mode: 'Markdown' }
  );
};

// ── CHECK TRANSACTION: Step 2 — look up and display ──────────────────────────
const processCheckTxRef = async (bot, msg, state) => {
  const chatId     = msg.chat.id;
  const telegramId = msg.from.id;
  const ref        = (msg.text || '').trim();

  if (!ref) {
    await conversationState.updateState(chatId, {});
    await bot.sendMessage(chatId, '❌ Please enter a valid reference:');
    return;
  }

  await conversationState.clearState(chatId);

  const token = await tokenManager.getToken(telegramId);
  if (!token) { await requireAuth(bot, chatId, telegramId); return; }

  try {
    const res = await axios.get(
      `${BACKEND_URL}/api/admin/games/users/${state.data.userId}/transaction-check?ref=${encodeURIComponent(ref)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const tx = res.data.transaction;
    const typeLabel = tx.type === 'deposit' ? '💰 Deposit' : '💸 Withdraw';

    await bot.sendMessage(
      chatId,
      `🔍 *Transaction Details*\n\n` +
      `📌 Type:       *${typeLabel}*\n` +
      `💵 Amount:     *$${Number(tx.amount).toFixed(2)}*\n` +
      `💳 Method:     *${tx.method || '—'}*\n` +
      `🆔 TX ID:      \`${tx.transaction_id || '—'}\`\n` +
      `🔢 TX Number:  \`${tx.transaction_number || '—'}\`\n` +
      `📝 Note:       ${tx.note || '—'}\n` +
      `🕐 Date:       ${formatDate(tx.created_at)}\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📊 Status:     *${statusEmoji(tx.status)}*\n\n` +
      (tx.status === 'pending'  ? '⏳ Your request is being reviewed by admin.' : '') +
      (tx.status === 'done'     ? '✅ This transaction has been completed.'     : '') +
      (tx.status === 'rejected' ? '❌ This transaction was rejected. Please contact support.' : ''),
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Wallet', callback_data: 'wallet:menu' }]] },
      }
    );
  } catch (err) {
    const is404 = err.response?.status === 404;
    await bot.sendMessage(
      chatId,
      is404
        ? `❌ *Transaction not found.*\n\nNo transaction with reference \`${ref}\` was found on your account.`
        : `❌ Could not check transaction: ${err.response?.data?.error || 'Please try again.'}`,
      { parse_mode: 'Markdown' }
    );
  }
};

// ── Transaction history list ──────────────────────────────────────────────────
const showTransactions = async (bot, chatId, telegramId) => {
  const token = await requireAuth(bot, chatId, telegramId);
  if (!token) return;
  const session = await tokenManager.getSession(telegramId);

  try {
    const res = await axios.get(
      `${BACKEND_URL}/api/admin/games/users/${session.userId}/transactions?limit=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const txs = res.data.transactions || [];

    if (txs.length === 0) {
      await bot.sendMessage(chatId, '📋 *Transaction History*\n\nNo transactions yet.', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'wallet:menu' }]] },
      });
      return;
    }

    let text = '📋 *Transaction History* (last 10)\n\n';
    txs.forEach((tx, i) => {
      const arrow = tx.type === 'deposit' ? '➕' : '➖';
      const sign  = tx.type === 'deposit' ? '+' : '-';
      text += `${arrow} *${sign}$${Number(tx.amount).toFixed(2)}*  ${tx.type === 'deposit' ? 'Deposit' : 'Withdraw'}\n`;
      text += `   💳 ${tx.method || '—'}\n`;
      text += `   🆔 \`${tx.transaction_id || '—'}\`\n`;
      if (tx.transaction_number) text += `   🔢 \`${tx.transaction_number}\`\n`;
      text += `   ${statusEmoji(tx.status)}   🕐 ${formatDate(tx.created_at)}\n`;
      if (i < txs.length - 1) text += '\n';
    });

    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Wallet', callback_data: 'wallet:menu' }]] },
    });
  } catch (err) {
    logger.error({ chatId, err: err.message }, 'transactions list failed');
    await bot.sendMessage(chatId, '❌ Could not load transactions. Please try again.');
  }
};

module.exports = {
  WALLET_STEPS,
  showWalletMenu,
  startDeposit,
  startWithdraw,
  startCheckTransaction,
  showTransactions,
  selectDepositMethod,
  selectWithdrawMethod,
  processDepositAmount,
  processDepositTxNum,
  processWithdrawAmount,
  processWithdrawAcct,
  processCheckTxRef,
};
