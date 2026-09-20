/**
 * e2e — signaling server (ZERO dependencies)
 * ------------------------------------------
 * Uses only Node's built-in modules (http + crypto) and implements the
 * WebSocket protocol (RFC 6455) directly. So you do NOT need `npm install`
 * at all — just run:
 *
 *     node server.js
 *
 * Same job as before: register peers, relay offer/answer/ICE messages.
 * It NEVER sees the actual chat / file / video data — all of that flows
 * directly browser-to-browser over WebRTC.
 */

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 9000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// Connected peers: id -> ws connection object
const peers = new Map();

// ---------- WebSocket helpers (RFC 6455) ----------

// Build an unmasked server->client frame for a text message
function sendFrame(socket, text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

// Parse whatever bytes have arrived so far; handle complete frames
function feedParser(ws, chunk) {
  ws.buffer = Buffer.concat([ws.buffer, chunk]);

  while (true) {
    const buf = ws.buffer;
    if (buf.length < 2) return;

    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;

    if (len === 126) {
      if (buf.length < 4) return;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return;
      len = Number(buf.readBigUInt64BE(2));
      off = 10;
    }

    let mask = null;
    if (masked) {
      if (buf.length < off + 4) return;
      mask = buf.subarray(off, off + 4);
      off += 4;
    }
    if (buf.length < off + len) return;

    let payload = buf.subarray(off, off + len);
    if (mask) {
      const un = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i & 3];
      payload = un;
    }
    ws.buffer = buf.subarray(off + len);

    if (opcode === 0x1) {
      // Text frame -> JSON message
      let msg;
      try {
        msg = JSON.parse(payload.toString('utf8'));
      } catch (_) {
        sendFrame(ws.socket, JSON.stringify({ type: 'error', error: 'invalid-json' }));
        continue;
      }
      handleMessage(ws, msg);
    } else if (opcode === 0x8) {
      // Close frame
      if (ws.id) {
        peers.delete(ws.id);
        console.log(`[-] disconnected: ${ws.id}`);
      }
      try { ws.socket.write(Buffer.from([0x88, 0])); } catch (_) {}
      ws.socket.destroy();
      return;
    } else if (opcode === 0x9) {
      // Ping -> Pong (echo payload back, unmasked)
      if (payload.length < 126) {
        ws.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
      }
    }
    // Pong (0xA) and continuation frames: safely ignored for our small JSON messages
  }
}

// ---------- e2e logic ----------

function handleMessage(ws, msg) {
  const send = (m) => sendFrame(ws.socket, JSON.stringify(m));

  if (msg.type === 'register') {
    const id = String(msg.id || '').trim();
    if (!id) return send({ type: 'error', error: 'no-id' });
    if (peers.has(id)) return send({ type: 'error', error: 'id-taken' });

    ws.id = id;
    peers.set(id, ws);
    console.log(`[+] registered: ${id}`);
    return send({ type: 'registered', id });
  }

  if (!ws.id) return send({ type: 'error', error: 'not-registered' });

  // List online peers (excluding the asker)
  if (msg.type === 'list') {
    const ids = [...peers.keys()].filter((p) => p !== ws.id);
    return send({ type: 'peers', ids });
  }

  const RELAY = ['offer', 'answer', 'candidate', 'bye', 'reject', 'typing'];
  if (RELAY.includes(msg.type)) {
    const target = peers.get(msg.to);
    if (!target) return send({ type: 'error', error: 'peer-not-found', to: msg.to });
    return sendFrame(target.socket, JSON.stringify({ ...msg, from: ws.id }));
  }

  send({ type: 'error', error: 'unknown-type' });
}

// ---------- HTTP + WebSocket server ----------

const server = http.createServer((req, res) => {
  // Plain HTTP: a simple status page so you can check the server in a browser
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('e2e signaling server is running.\n');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();

  const accept = crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n'
  );

  const ws = { socket, id: null, buffer: Buffer.alloc(0) };
  socket.on('data', (chunk) => feedParser(ws, chunk));
  socket.on('close', () => {
    if (ws.id) {
      peers.delete(ws.id);
      console.log(`[-] disconnected: ${ws.id}`);
    }
  });
  socket.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`e2e signaling server running on ws://localhost:${PORT}`);
  console.log('(zero dependencies — no npm install needed)');
});
