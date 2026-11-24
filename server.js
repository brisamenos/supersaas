// SuperSaaS — painel central que conecta todos os sistemas (BarberSync, EstimaFood, MotoStock...)
const express = require('express');
const path = require('path');
const { ensureAdmin } = require('./lib/auth');
const sync = require('./lib/sync');
const reports = require('./lib/reports');

const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api', require('./lib/routes'));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((e, req, res, next) => { console.error('[erro]', e); res.status(500).json({ error: 'Erro interno. Tente de novo.' }); });

ensureAdmin();
app.listen(PORT, () => {
  console.log(`SuperSaaS rodando em http://localhost:${PORT}`);
  sync.startSync();
  reports.startScheduler();
});
