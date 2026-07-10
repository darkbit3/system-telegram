// index.js — compatibility shim only.
// The real entry point is src/bot.js (see package.json "main" / "start").
// This file exists solely so any external tooling that looks for index.js
// still works; it does NOT start a second bot or re-attach polling.
require('dotenv').config();
require('./src/bot');
