const conversationState = require('../security/conversationState');
const {
  processLoginPassword,
  processRegUsername,
  processRegPassword,
  STEPS
} = require('./contactHandler');
const { processProfileUsername, processProfilePassword, PROFILE_UPDATE_STEPS } = require('./menuHandler');
const {
  processDepositAmount,
  processDepositTxNum,
  processWithdrawAmount,
  processWithdrawAcct,
  processCheckTxRef,
  WALLET_STEPS,
} = require('./walletHandler');

const handleMessages = (bot) => {
  bot.on('message', (msg) => {
    if (msg.contact) return;
    if (!msg.text) return;
    if (msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const state  = conversationState.getState(chatId);
    if (!state) return;

    switch (state.step) {
      case STEPS.LOGIN_PASSWORD:           processLoginPassword(bot, msg, state);   break;
      case STEPS.REG_USERNAME:             processRegUsername(bot, msg, state);     break;
      case STEPS.REG_PASSWORD:             processRegPassword(bot, msg, state);     break;
      case PROFILE_UPDATE_STEPS.USERNAME:  processProfileUsername(bot, msg, state); break;
      case PROFILE_UPDATE_STEPS.PASSWORD:  processProfilePassword(bot, msg, state); break;
      case WALLET_STEPS.DEPOSIT_AMOUNT:    processDepositAmount(bot, msg, state);   break;
      case WALLET_STEPS.DEPOSIT_TX_NUM:    processDepositTxNum(bot, msg, state);    break;
      case WALLET_STEPS.WITHDRAW_AMOUNT:   processWithdrawAmount(bot, msg, state);  break;
      case WALLET_STEPS.WITHDRAW_ACCT:     processWithdrawAcct(bot, msg, state);    break;
      case WALLET_STEPS.CHECK_TX_REF:      processCheckTxRef(bot, msg, state);      break;
      default: break;
    }
  });
};

module.exports = { handleMessages };
