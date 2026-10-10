// Classroom sync server: serves the built app and relays the teacher's state to
// students over Server-Sent Events. No dependencies; pair a POST /api/publish
// (host) with GET /api/events (viewers) inside one classroom room code.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOM_PATTERN = /^[A-HJ-NP-Z2-9]{4,8}$/;
const MAX_BODY = 262_144;
const MAX_MESSAGE = 200_000;
const MESSAGE_TYPES = new Set(['workspace', 'step']);
const IDLE_ROOM_MS = 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function defaultRoot() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  for (const candidate of [join(here, '..', 'dist'), join(here, '..')]) {
    if (existsSync(join(candidate, 'index.html'))) return candidate;
  }
  return join(here, '..', 'dist');
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function normalizePublicOrigin(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment');
  }
}

export function createSyncServer({ root, logger = console, publicOrigin = '', discoverLan = true } = {}) {
  const origin = normalizePublicOrigin(publicOrigin);
  const staticRoot = resolve(root ?? defaultRoot());
  let listeningPort = 0;
  const rooms = new Map();
  const roomOf = id => {
    if (!rooms.has(id)) rooms.set(id, { key: null, subscribers: new Set(), last: new Map(), activity: Date.now() });
    return rooms.get(id);
  };
  const viewerCount = room => [...room.subscribers].filter(sub => sub.role === 'viewer').length;
  const send = (subscriber, payload) => {
    try { subscriber.res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* closed between writes */ }
  };
  const broadcast = (room, payload, except) => {
    for (const subscriber of room.subscribers) if (subscriber !== except) send(subscriber, payload);
  };
  const publishPresence = room => {
    const viewers = viewerCount(room);
    for (const subscriber of room.subscribers) if (subscriber.role === 'host') send(subscriber, { type: 'presence', viewers });
  };

  const handleEvents = (req, res, url) => {
    const id = (url.searchParams.get('room') ?? '').toUpperCase();
    if (!ROOM_PATTERN.test(id)) return json(res, 400, { error: '房间码无效' });
    const room = roomOf(id);
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'viewer';
    // Before the first publish there is no key yet: the teacher's presence
    // connection may race ahead of it, so only reject a clear mismatch.
    if (role === 'host' && room.key && url.searchParams.get('key') !== room.key) return json(res, 403, { error: '不是本次共享的主讲' });
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const subscriber = { res, role };
    room.subscribers.add(subscriber);
    room.activity = Date.now();
    if (role === 'viewer') {
      // Late joiners immediately receive the current classroom state.
      for (const type of ['workspace', 'step']) {
        const last = room.last.get(type);
        if (last) send(subscriber, last);
      }
    }
    publishPresence(room);
    const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      room.subscribers.delete(subscriber);
      publishPresence(room);
    });
  };

  const handlePublish = (req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) return req.destroy();
      chunks.push(chunk);
    });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return json(res, 400, { error: '请求格式错误' }); }
      const id = String(body?.room ?? '').toUpperCase();
      const key = body?.key;
      const message = body?.message;
      if (!ROOM_PATTERN.test(id)) return json(res, 400, { error: '房间码无效' });
      if (typeof key !== 'string' || key.length < 8) return json(res, 400, { error: '缺少共享密钥' });
      if (!message || typeof message !== 'object' || !MESSAGE_TYPES.has(message.type)) return json(res, 400, { error: '消息类型无效' });
      const text = JSON.stringify(message);
      if (text.length > MAX_MESSAGE) return json(res, 413, { error: '消息过大' });
      const room = roomOf(id);
      if (!room.key) room.key = key;
      else if (room.key !== key) return json(res, 403, { error: '不是本次共享的主讲' });
      room.activity = Date.now();
      room.last.set(message.type, message);
      broadcast(room, message);
      json(res, 200, { ok: true, viewers: viewerCount(room) });
    });
  };

  const serveFile = (res, pathname) => {
    const relative = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^([/\\])+/, '');
    const file = resolve(staticRoot, relative);
    if (!file.startsWith(staticRoot) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(file).pipe(res);
  };

  const server = createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return json(res, 400, { error: 'bad url' }); }
    if (url.pathname === '/api/health') {
      const index = join(staticRoot, 'index.html');
      let ok = false;
      try { ok = statSync(index).isFile(); } catch { /* build missing */ }
      res.setHeader('cache-control', 'no-store');
      return json(res, ok ? 200 : 503, { ok });
    }
    if (url.pathname === '/api/events') return handleEvents(req, res, url);
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'c-lab' });
    if (url.pathname === '/api/publish') {
      if (req.method !== 'POST') return json(res, 405, { error: '仅支持 POST' });
      return handlePublish(req, res);
    }
    if (url.pathname === '/api/room') {
      const room = rooms.get((url.searchParams.get('room') ?? '').toUpperCase());
      return json(res, 200, { exists: !!room?.key, viewers: room ? viewerCount(room) : 0 });
    }
    if (url.pathname === '/api/info') {
      // Container interface addresses and internal ports are not student-facing.
      res.setHeader('cache-control', 'no-store');
      return json(res, 200, {
        port: listeningPort,
        publicOrigin: origin,
        addresses: discoverLan && !origin ? lanAddresses().map(item => item.address) : [],
      });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    return serveFile(res, url.pathname);
  });

  const sweep = setInterval(() => {
    const limit = Date.now() - IDLE_ROOM_MS;
    for (const [id, room] of rooms) if (!room.subscribers.size && room.activity < limit) rooms.delete(id);
  }, 10 * 60 * 1000);
  sweep.unref();

  const close = async () => {
    clearInterval(sweep);
    for (const room of rooms.values()) for (const subscriber of room.subscribers) subscriber.res.end();
    rooms.clear();
    await new Promise(done => server.close(done));
  };

  return {
    server,
    close,
    listen(port = 8000, host = '0.0.0.0') {
      return new Promise((resolvePort, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          listeningPort = server.address().port;
          resolvePort(listeningPort);
        });
      });
    },
  };
}

// Docker, virtual machines and VPNs create extra adapters students cannot reach;
// keep only physical-looking ones and order real LAN ranges first.
const VIRTUAL_NAME = /^(br-|docker|veth|virbr|vmnet|vboxnet|podman|tailscale|zt|wg|tun|tap|utun|dummy|lo)/i;
const VIRTUAL_RANGE = /^172\.(1[6-9]|2\d|3[01])\./;

function lanAddresses() {
  const all = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      all.push({ name, address: entry.address, virtual: VIRTUAL_NAME.test(name) });
    }
  }
  const real = all.filter(item => !item.virtual);
  const list = real.length ? real : all;
  list.sort((a, b) => Number(VIRTUAL_RANGE.test(b.address)) - Number(VIRTUAL_RANGE.test(a.address)));
  return [...new Map(list.map(item => [item.address, item])).values()];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const basePort = Number(process.env.PORT || 8000);
  const host = process.env.HOST || '0.0.0.0';
  const discoverLan = process.env.DISCOVER_LAN !== '0';
  let publicOrigin;
  let instance;
  try {
    publicOrigin = normalizePublicOrigin(process.env.PUBLIC_ORIGIN);
    instance = createSyncServer({ root: process.env.STATIC_ROOT, publicOrigin, discoverLan });
  } catch (error) {
    console.error(`无法启动服务：${error.message}`);
    process.exit(1);
  }
  const start = (port, attempts) => instance.listen(port, host).then(actual => {
    console.log('C Lab 课堂服务已启动');
    if (actual !== basePort) console.log(`  （端口 ${basePort} 被系统或其他程序占用，已自动改用 ${actual}）`);
    console.log(`  教师打开：${publicOrigin || `http://localhost:${actual}`}`);
    const addresses = discoverLan && !publicOrigin ? lanAddresses() : [];
    addresses.slice(0, 2).forEach((item, index) => {
      console.log(`  学生打开${index === 0 ? '（首选）' : '（备用）'}：http://${item.address}:${actual}`);
    });
    if (addresses.length > 2) console.log(`  其余 ${addresses.length - 2} 个是虚拟网卡，学生用不上，已隐藏。`);
    if (publicOrigin) console.log(`  学生访问：${publicOrigin}`);
    else if (!discoverLan) console.log('  容器部署：请使用宿主机地址和映射端口访问；可设置 PUBLIC_ORIGIN 生成学生加入链接。');
    else if (!addresses.length) console.log('  未检测到局域网地址，请检查网络连接。');
    console.log('  学生打不开时：确认在同一网络，并让系统防火墙放行本端口。');
    console.log('  点击右上角「课堂同步」开始共享；按 Ctrl+C 停止。');
  }).catch(error => {
    // Windows sometimes reports a phantom "address in use" on a port with no
    // visible listener (reserved or mirrored ranges); just move on.
    if (error && error.code === 'EADDRINUSE' && !process.env.PORT && attempts > 0) {
      console.log(`端口 ${port} 已被占用，尝试 ${port + 1} …`);
      return start(port + 1, attempts - 1);
    }
    if (error && error.code === 'EADDRINUSE') {
      console.error(`无法启动服务：端口 ${port} 已被占用。`);
      console.error('通常是因为已经有一个课堂服务在运行，请先关闭它；');
      console.error('或换一个端口再启动，例如：');
      console.error('  set PORT=8100 && node server\\serve.mjs   （Windows）');
      console.error('  PORT=8100 node server/serve.mjs          （Linux / macOS / WSL）');
    } else {
      console.error(`无法启动服务：${error.message}`);
    }
    process.exit(1);
  });
  start(basePort, 20);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    instance.close().then(() => {
      clearTimeout(deadline);
      process.exit(0);
    }).catch(error => {
      console.error(`关闭服务失败：${error.message}`);
      process.exit(1);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
