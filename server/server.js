const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  if (req.url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'pong', time: new Date().toISOString() }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const clientId = Math.random().toString(36).slice(2, 8);
  console.log(`[WS] client connected: ${clientId}`);

  ws.send(JSON.stringify({ type: 'welcome', clientId, time: new Date().toISOString() }));

  // Send a ping every 5 seconds
  const interval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', time: new Date().toISOString() }));
    }
  }, 5000);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { msg = { raw: data.toString() }; }
    console.log(`[WS] message from ${clientId}:`, msg);
    ws.send(JSON.stringify({ type: 'echo', clientId, payload: msg, time: new Date().toISOString() }));
  });

  ws.on('close', () => {
    clearInterval(interval);
    console.log(`[WS] client disconnected: ${clientId}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
