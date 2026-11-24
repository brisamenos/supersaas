// Tempo real: o painel abre uma conexao SSE e recebe um aviso sempre que algo muda
const clients = new Set();
function addClient(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  clients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { /* conexao caiu */ } }, 25000);
  res.on('close', () => { clearInterval(ping); clients.delete(res); });
}
function emit(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data || {})}\n\n`;
  for (const r of clients) { try { r.write(msg); } catch (_) { clients.delete(r); } }
}
module.exports = { addClient, emit, count: () => clients.size };
