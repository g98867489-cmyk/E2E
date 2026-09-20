# e2e

A tiny PeerJS-style WebRTC library — build your own peer-to-peer connections
without depending on anyone else's cloud server.

**e2e** has exactly two parts:

| File         | What it is                                                   |
|--------------|--------------------------------------------------------------|
| `server.js`  | Signaling server (Node.js + `ws`). Registers peers and relays offer / answer / ICE messages. It NEVER sees your actual data. |
| `e2e.js`     | Browser client library. Wraps WebRTC (RTCPeerConnection + data channels) behind a simple PeerJS-like API. |
| `demo.html`  | A ready-made P2P chat demo using the library. |

## Why "e2e"?

Because once the handshake is done, all data flows **end-to-end** —
browser to browser — and the signaling server only ever sees connection
metadata (SDP + ICE candidates), never your messages, files or calls.

## Quick start

```bash
node server.js          # starts signaling server on ws://localhost:9000
                        # (or set PORT env var)
```

**No `npm install` needed** — the server is zero-dependency (Node's built-in
`http` + `crypto` modules implement the WebSocket protocol directly).

Then serve the folder and open `demo.html` in **two browser tabs/windows**:

```bash
npx serve .             # or: python3 -m http.server
```

- Tab 1: set Your ID = `alice` → Connect
- Tab 2: set Your ID = `bob`, Connect to peer = `alice` → Connect
- Chat away — data goes directly tab-to-tab, not through any server.

## Client API

```js
const peer = new e2e.Peer({ id: 'alice', server: 'ws://localhost:9000' });

peer.on('open', (myId) => { /* registered with signaling server */ });
peer.on('connection', (conn) => { /* incoming connection */ });
peer.on('error', (err) => { /* e.g. id-taken, peer-not-found */ });

// Outgoing connection
const conn = peer.connect('bob');
conn.on('open', () => conn.send('hello!'));
conn.on('data', (d) => console.log('received', d));
conn.on('close', () => console.log('peer left'));

conn.send({ any: 'json', or: 'plain strings' });
conn.close();

peer.destroy();         // close everything
```

## How the handshake works

1. Both peers open a WebSocket to the signaling server and register their IDs.
2. Alice calls `connect('bob')`:
   - her browser creates an `RTCPeerConnection` + data channel,
   - generates an **SDP offer** and sends it to the server,
   - the server relays it to bob.
3. Bob's browser (via the `connection` event) answers with an **SDP answer**.
4. Both sides exchange **ICE candidates** through the server until a direct
   route (NAT hole-punch) is found.
5. The data channel opens — from now on the server is out of the picture.

STUN servers (Google's public ones by default) help peers discover their
public network addresses. For strict NATs/firewalls you would add a TURN
server (`iceServers` option inside `e2e.js`).

## Run tests

```bash
node server.js          # terminal 1 (default port 9000)
node test-signaling.js  # terminal 2
```

To use another port: `PORT=9001 node server.js` and
`E2E_PORT=9001 node test-signaling.js` (Windows cmd:
`set PORT=9001` / `set E2E_PORT=9001`).

The test simulates two peers with plain TCP sockets and verifies register,
offer/answer/ICE relay, unknown-peer errors, and duplicate-ID rejection —
also with zero dependencies.

## Premium suite (chat.html)

`chat.html` is a single-file, black-glass-themed P2P app with:

- Text chat with clickable links + typing indicator
- File sharing of ANY type (images, videos, audio, PDF, documents...) via
  chunked DataChannel transfer with backpressure (4 MB buffer cap, 16 KB
  chunks) — big files stream smoothly without freezing the chat
- Inline previews for images, videos and audio; download card for the rest
- Voice calls and video calls (accept/reject UI, mute, call timer) over a
  dedicated media connection
- Drag-and-drop + clipboard-paste file sending
- LAN-only mode (no external STUN servers) enabled by default

## WhatsApp-style suite (v0.5)

- Contact list (max 10) with online/offline status + unread badges + last-message previews
- Session memory: naam/server saved — page kholte hi auto-connect, baar-baar details nahi daalni
- Auto-reconnect: signaling server gir bhi jaaye toh har 4s retry hota hai (data channels zinda rehte hain)
- Chat history localStorage mein save — refresh ke baad bhi chat dikhti hai
- Saturn Lock: chat header/sidebar ke lock button se lock screen — Saturn planet (pure CSS) + facts
  (Galileo 1610, Huygens rings 1655, Earth se ~120-170 crore km, 140+ moons...)
- Voice + video calls, file sharing (image/video/audio/PDF/koi bhi file) with progress — sab per-peer

## Notes & limitations

- Demo uses `ws://` — for real deployments put the server behind `wss://`
  (e.g. nginx + Let's Encrypt) since browsers require secure contexts for
  WebRTC in many settings.
- No reconnection logic, chunking for big files, or media (audio/video)
  support yet — those are good next steps. PeerJS itself is roughly this
  code plus those features and ~10 years of edge-case fixes.
- Deploy the signaling server anywhere Node runs: a ₹300/month VPS,
  Render, Railway, Fly.io, etc.
