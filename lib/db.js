// Banco do SuperSaaS (SQLite). Guarda sistemas conectados, copia dos clientes, historico, financeiro, leads e logs.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'supersaas.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',            -- admin | viewer (so olha)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE IF NOT EXISTS systems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'custom',           -- barbersync | estimafood | motostock | custom
    base_url TEXT NOT NULL,
    token TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    unit TEXT DEFAULT 'movimentos',                -- o que o sistema conta: agendamentos, pedidos, vendas
    client_word TEXT DEFAULT 'cliente',            -- barbearia, loja...
    login_path TEXT DEFAULT '/',
    status TEXT NOT NULL DEFAULT 'unknown',        -- online | offline | unknown
    latency_ms INTEGER,
    last_error TEXT,
    last_ok_at TEXT,
    last_sync_at TEXT,
    fail_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Copia local dos clientes de cada sistema (atualizada a cada ~30 s)
  CREATE TABLE IF NOT EXISTS clients (
    system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    ext_id TEXT NOT NULL,
    name TEXT, slug TEXT, plan TEXT, active INTEGER, expires_at TEXT, price REAL, phone TEXT, email TEXT,
    remote_created_at TEXT,
    activity_today INTEGER DEFAULT 0, volume_today REAL DEFAULT 0, activity_month INTEGER DEFAULT 0, volume_month REAL DEFAULT 0, last_activity TEXT,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    gone INTEGER NOT NULL DEFAULT 0,               -- sumiu do sistema (foi excluido la)
    PRIMARY KEY (system_id, ext_id)
  );

  -- Foto periodica de cada sistema (para os graficos de evolucao)
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    day TEXT NOT NULL,
    system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    clients_total INTEGER, clients_active INTEGER, expired INTEGER, mrr REAL,
    volume_today REAL, volume_month REAL, activity_today INTEGER, latency_ms INTEGER, online INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_snap_day ON snapshots (system_id, day, ts);

  CREATE TABLE IF NOT EXISTS health_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    type TEXT NOT NULL,                            -- down | up
    message TEXT
  );

  -- Livro-caixa do SuperSaaS: receitas (mensalidades recebidas) e despesas (servidor, anuncios...)
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    type TEXT NOT NULL,                            -- receita | despesa
    category TEXT,
    description TEXT,
    amount REAL NOT NULL,
    system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL,
    client_ext_id TEXT,
    client_name TEXT,
    source TEXT NOT NULL DEFAULT 'manual',         -- manual | renovacao
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger (date);

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, phone TEXT, email TEXT, company TEXT,
    source TEXT,                                   -- Instagram, Indicacao, Anuncio...
    system_kind TEXT,                              -- sistema de interesse
    stage TEXT NOT NULL DEFAULT 'novo',            -- novo | contato | demo | proposta | fechado | perdido
    value REAL DEFAULT 0,
    next_followup TEXT,
    notes TEXT,
    campaign_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    channel TEXT,                                  -- Meta Ads, Google Ads, Instagram organico, Indicacao...
    system_kind TEXT,
    start_date TEXT, end_date TEXT,
    spent REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ativa',          -- ativa | pausada | encerrada
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS message_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    kind TEXT, to_phone TEXT, to_name TEXT, text TEXT, ok INTEGER NOT NULL DEFAULT 0, error TEXT
  );
  CREATE TABLE IF NOT EXISTS report_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    kind TEXT, trigger TEXT, ok INTEGER NOT NULL DEFAULT 0, error TEXT, text TEXT
  );
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    user TEXT, action TEXT, detail TEXT
  );
`);

// ---------- configuracoes (chave/valor) ----------
const getSetting = (k, def = null) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r && r.value !== null ? r.value : def; };
const setSetting = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v === null || v === undefined ? null : String(v));
const getJSON = (k, def) => { try { const v = getSetting(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const setJSON = (k, v) => setSetting(k, JSON.stringify(v));
const audit = (user, action, detail) => { try { db.prepare('INSERT INTO audit (user, action, detail) VALUES (?, ?, ?)').run(user || 'sistema', action, String(detail || '').slice(0, 500)); } catch (_) { /* log nao pode derrubar nada */ } };

// foto de perfil (guardada no próprio banco, já reduzida pelo navegador para 256 x 256)
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
// cargo que aparece na saudação ("Olá, CEO Igor"); o dono (primeiro administrador) já começa como CEO
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'title')) {
  db.exec('ALTER TABLE users ADD COLUMN title TEXT');
  db.prepare("UPDATE users SET title = 'CEO' WHERE id = (SELECT MIN(id) FROM users WHERE role = 'admin')").run();
}

module.exports = { db, DB_PATH, getSetting, setSetting, getJSON, setJSON, audit };
