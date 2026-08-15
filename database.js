const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Usar /tmp en serverless (Replit/Render) para persistencia entre reinicios
// En VPS propio, cambiar a __dirname
const dbDir = process.env.SQLITE_DIR || '/tmp';
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, 'chattaiko.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('❌ Error abriendo DB:', err.message);
  else console.log('✅ SQLite:', dbPath);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    name TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => { if (err) console.error('DB users:', err.message); });

  db.run(`CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    api_name TEXT,
    model TEXT,
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    success INTEGER DEFAULT 1,
    error_msg TEXT,
    latency_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => { if (err) console.error('DB logs:', err.message); });

  db.run(`CREATE TABLE IF NOT EXISTS owner_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT UNIQUE NOT NULL,
    service_name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    api_url TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => { if (err) console.error('DB keys:', err.message); });

  // Índices para rendimiento
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_user ON usage_logs(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_created ON usage_logs(created_at)`);
});

module.exports = db;
