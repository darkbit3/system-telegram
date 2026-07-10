/**
 * src/store/db.js
 *
 * Opens (or creates) the SQLite database that backs both the session store
 * and the conversation-state store. The file lives next to the project root
 * so it survives npm installs and nodemon restarts.
 *
 * Both tables are created here so the rest of the codebase only needs to
 * require this module; they never touch the DB file path directly.
 */

const path = require('path');
const Database = require('better-sqlite3');

// Place the DB file one level above src/ (i.e. telegram/bot.db)
const DB_PATH = path.resolve(__dirname, '..', '..', 'bot.db');

const db = new Database(DB_PATH);

// ─── Performance pragmas ──────────────────────────────────────────────────────
db.pragma('journal_mode = WAL');   // concurrent reads while writing
db.pragma('synchronous = NORMAL'); // safe + fast for a single-process bot

// ─── Sessions table ───────────────────────────────────────────────────────────
// telegram_id is stored as TEXT because JS numbers > 2^53 can exceed SQLite
// INTEGER range and Telegram IDs are already large.
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    telegram_id  TEXT    PRIMARY KEY,
    token        TEXT    NOT NULL,
    user_id      TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    last_active  INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  )
`);

// ─── Conversation state table ─────────────────────────────────────────────────
// chat_id is TEXT for the same overflow reason.
// data is stored as a JSON string.
db.exec(`
  CREATE TABLE IF NOT EXISTS conversation_state (
    chat_id    TEXT    PRIMARY KEY,
    step       TEXT    NOT NULL,
    data       TEXT    NOT NULL DEFAULT '{}',
    expires_at INTEGER NOT NULL
  )
`);

module.exports = db;
