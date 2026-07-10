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
  bot.on('message', async (msg) => {
    if (msg.contact) return;
    if (!msg.text)   return;
    if (msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const state  = await conversationState.getState(chatId);
    if (!state) return;

    switch (state.step) {
      case STEPS.LOGIN_PASSWORD:           await processLoginPassword(bot, msg, state);   break;
      case STEPS.REG_USERNAME:             await processRegUsername(bot, msg, state);     break;
      case STEPS.REG_PASSWORD:             await processRegPassword(bot, msg, state);     break;
      case PROFILE_UPDATE_STEPS.USERNAME:  await processProfileUsername(bot, msg, state); break;
      case PROFILE_UPDATE_STEPS.PASSWORD:  await processProfilePassword(bot, msg, state); break;
      case WALLET_STEPS.DEPOSIT_AMOUNT:    await processDepositAmount(bot, msg, state);   break;
      case WALLET_STEPS.DEPOSIT_TX_NUM:    await processDepositTxNum(bot, msg, state);    break;
      case WALLET_STEPS.WITHDRAW_AMOUNT:   await processWithdrawAmount(bot, msg, state);  break;
      case WALLET_STEPS.WITHDRAW_ACCT:     await processWithdrawAcct(bot, msg, state);    break;
      case WALLET_STEPS.CHECK_TX_REF:      await processCheckTxRef(bot, msg, state);      break;
      default: break;
    }
  });
};

module.exports = { handleMessages };
