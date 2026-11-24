// Login do SuperSaaS (JWT) + criacao do primeiro administrador
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db, getSetting, setSetting, audit } = require('./db');

function jwtSecret() {
  if (process.env.HUB_JWT_SECRET) return process.env.HUB_JWT_SECRET;
  let s = getSetting('jwt_secret');
  if (!s) { s = crypto.randomBytes(48).toString('hex'); setSetting('jwt_secret', s); }
  return s;
}
const signToken = user => jwt.sign({ sub: user.id, email: user.email, name: user.name, role: user.role }, jwtSecret(), { expiresIn: '7d' });

// Primeiro acesso: usa HUB_ADMIN_EMAIL / HUB_ADMIN_PASSWORD; sem eles, cria uma senha aleatoria e mostra no log UMA vez.
function ensureAdmin() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return;
  const email = (process.env.HUB_ADMIN_EMAIL || 'admin@supersaas.local').toLowerCase();
  let password = process.env.HUB_ADMIN_PASSWORD, generated = false;
  if (!password) { password = crypto.randomBytes(9).toString('base64url'); generated = true; }
  db.prepare('INSERT INTO users (email, name, password_hash, role, title) VALUES (?, ?, ?, ?, ?)').run(email, 'Administrador', bcrypt.hashSync(password, 10), 'admin', 'CEO'); // o dono já começa como CEO na saudação
  console.log('\n============================================================');
  console.log(' SuperSaaS: primeiro acesso criado');
  console.log('   E-mail: ' + email);
  console.log(generated ? '   Senha : ' + password + '   (anote agora; troque depois em Configurações)' : '   Senha : a definida em HUB_ADMIN_PASSWORD');
  console.log('============================================================\n');
}

// Limite de tentativas de login (por IP + e-mail)
const tries = new Map();
function loginBlocked(key) { const t = tries.get(key); return t && t.n >= 8 && Date.now() - t.ts < 5 * 60 * 1000; }
function loginFail(key) { const t = tries.get(key); if (!t || Date.now() - t.ts > 5 * 60 * 1000) tries.set(key, { n: 1, ts: Date.now() }); else t.n++; }
function loginOk(key) { tries.delete(key); }

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
  if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });
  try {
    req.user = jwt.verify(token, jwtSecret());
    const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.user.sub);
    if (!u) return res.status(401).json({ error: 'Usuário não existe mais.' });
    req.user.role = u.role;
    next();
  } catch (_) { return res.status(401).json({ error: 'Sessão expirada. Entre de novo.' }); }
}
// Quem tem perfil "viewer" so consulta; qualquer alteracao exige administrador
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).json({ error: 'Seu acesso é só de visualização.' });
}

module.exports = { signToken, ensureAdmin, requireAuth, requireAdmin, loginBlocked, loginFail, loginOk, audit };
