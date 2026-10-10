import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSyncServer, type SyncServer } from '../../server/serve.mjs';

let instance: SyncServer;
let base = '';
let root = '';

async function subscribe(path: string, signal: AbortSignal) {
  const response = await fetch(base + path, { signal });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(timeoutMs = 4000): Promise<any> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const index = buffer.indexOf('\n\n');
        if (index >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = block.split('\n').find(item => item.startsWith('data: '));
          if (line) return JSON.parse(line.slice(6));
          continue;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('等待 SSE 消息超时')), Math.max(1, deadline - Date.now()));
        });
        const result = await Promise.race([reader.read(), timeout]);
        clearTimeout(timer);
        if (result.done) throw new Error('SSE 连接已关闭');
        buffer += decoder.decode(result.value, { stream: true });
      }
    },
  };
}

const publish = (room: string, key: string, message: unknown) => fetch(base + '/api/publish', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ room, key, message }),
});

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'c-lab-sync-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>lab</title>');
  writeFileSync(join(root, 'test.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  instance = createSyncServer({ root });
  base = `http://127.0.0.1:${await instance.listen(0, '127.0.0.1')}`;
});

afterAll(async () => {
  await instance?.close();
  rmSync(root, { recursive: true, force: true });
});

it('serves the static app with wasm-friendly MIME configuration', async () => {
  const response = await fetch(base + '/');
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('lab');
  const wasm = await fetch(base + '/test.wasm');
  expect(wasm.headers.get('content-type')).toBe('application/wasm');
  expect((await wasm.arrayBuffer()).byteLength).toBe(8);
  expect(await fetch(base + '/../etc/passwd').then(r => r.status)).toBe(404);
});

it('reports its port and LAN addresses for building share links', async () => {
  const info = await (await fetch(base + '/api/info')).json();
  expect(Number.isInteger(info.port)).toBe(true);
  expect(info.port).toBeGreaterThan(0);
  expect(Array.isArray(info.addresses)).toBe(true);
  for (const address of info.addresses) expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
});

it('provides an uncached readiness endpoint', async () => {
  const response = await fetch(base + '/api/health');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ ok: true });
});

it('reports not ready when the static build is missing', async () => {
  const server = createSyncServer({ root: join(root, 'missing'), discoverLan: false });
  try {
    const port = await server.listen(0, '127.0.0.1');
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
  } finally { await server.close(); }
});

it.each([
  ['https://clab.example.com/', true, 'https://clab.example.com'],
  ['http://192.168.1.10:9000', false, 'http://192.168.1.10:9000'],
  ['', false, ''],
] as const)('uses container-safe info for origin %s and discovery %s', async (publicOrigin, discoverLan, expected) => {
  const server = createSyncServer({ root, publicOrigin, discoverLan });
  try {
    const port = await server.listen(0, '127.0.0.1');
    const response = await fetch(`http://127.0.0.1:${port}/api/info`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ port, publicOrigin: expected, addresses: [] });
  } finally { await server.close(); }
});

it.each([
  'not-a-url', 'ftp://example.com', 'https://user:pass@example.com',
  'https://example.com/lab', 'https://example.com/?a=1', 'https://example.com/#x',
])('rejects invalid public origin %s before starting the server', publicOrigin => {
  expect(() => createSyncServer({ root, publicOrigin })).toThrow('PUBLIC_ORIGIN');
});

it('closes active SSE streams during shutdown', async () => {
  const server = createSyncServer({ root });
  const controller = new AbortController();
  try {
    const port = await server.listen(0, '127.0.0.1');
    const response = await fetch(`http://127.0.0.1:${port}/api/events?room=ABC789`, { signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read();
    const closing = server.close();
    expect((await reader.read()).done).toBe(true);
    await closing;
  } finally {
    controller.abort();
    if (server.server.listening) await server.close();
  }
});

it('relays workspace and step messages to viewers and replays them on late join', async () => {
  expect(await (await fetch(base + '/api/room?room=ABC234')).json()).toEqual({ exists: false, viewers: 0 });
  const controller = new AbortController();
  const viewer = await subscribe('/api/events?room=ABC234', controller.signal);
  const key = 'a'.repeat(32);

  const workspace = { type: 'workspace', lessonId: 'arrays', files: { 'main.c': 'int main(){}' }, input: '' };
  const first = await publish('ABC234', key, workspace);
  expect(await first.json()).toEqual({ ok: true, viewers: 1 });
  expect(await viewer.next()).toEqual(workspace);

  const step = { type: 'step', step: 4, playing: true };
  expect((await publish('ABC234', key, step)).status).toBe(200);
  expect(await viewer.next()).toEqual(step);

  expect(await (await fetch(base + '/api/room?room=ABC234')).json()).toEqual({ exists: true, viewers: 1 });

  // A student joining later still receives the current classroom state.
  const late = await subscribe('/api/events?room=ABC234', new AbortController().signal);
  expect(await late.next()).toEqual(workspace);
  expect(await late.next()).toEqual(step);
  controller.abort();
});

it('rejects foreign keys, invalid rooms and oversized payloads', async () => {
  const key = 'b'.repeat(32);
  expect((await publish('XYZ789', key, { type: 'step', step: 1, playing: false })).status).toBe(200);
  expect((await publish('XYZ789', 'c'.repeat(32), { type: 'step', step: 2, playing: false })).status).toBe(403);
  expect((await publish('bad room', key, { type: 'step', step: 1, playing: false })).status).toBe(400);
  expect((await publish('XYZ789', key, { type: 'nope' })).status).toBe(400);
  expect((await publish('XYZ789', key, { type: 'workspace', lessonId: 'a', files: { 'main.c': 'x'.repeat(200_001) }, input: '' })).status).toBe(413);
  expect((await fetch(base + '/api/events?room=XYZ789&role=host&key=wrong-00000000')).status).toBe(403);
});

it('reports presence to the host when students join and leave', async () => {
  const key = 'd'.repeat(32);
  expect((await publish('MNP345', key, { type: 'step', step: 1, playing: false })).status).toBe(200);
  const host = await subscribe(`/api/events?room=MNP345&role=host&key=${key}`, new AbortController().signal);
  expect(await host.next()).toEqual({ type: 'presence', viewers: 0 });
  const controller = new AbortController();
  await subscribe('/api/events?room=MNP345', controller.signal);
  expect(await host.next()).toEqual({ type: 'presence', viewers: 1 });
  controller.abort();
  expect(await host.next()).toEqual({ type: 'presence', viewers: 0 });
});
