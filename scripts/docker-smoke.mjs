// Self-contained Docker deployment check. Uses only Node built-ins.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const project = `c-lab-smoke-${randomUUID().slice(0, 8)}`;
const env = { ...process.env, BIND_ADDRESS: '127.0.0.1', HTTP_PORT: '0', PUBLIC_ORIGIN: 'https://clab.example.com:8443' };
const composeArgs = ['compose', '-f', 'compose.yaml', '-p', project];
const streams = [];

function docker(args, capture = false, timeout = 600_000) {
  const result = spawnSync('docker', args, {
    cwd, env, encoding: 'utf8', timeout,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `docker ${args.join(' ')} failed\n${result.stderr ?? ''}`);
  return result.stdout?.trim();
}
const compose = (args, capture = false, timeout) => docker([...composeArgs, ...args], capture, timeout);
const request = (url, options = {}) => fetch(url, { signal: AbortSignal.timeout(10_000), ...options });

async function subscribe(base, room) {
  const controller = new AbortController();
  streams.push(controller);
  const response = await request(`${base}/api/events?room=${room}`, {
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    reader,
    async next() {
      for (;;) {
        const index = buffer.indexOf('\n\n');
        if (index >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = block.split('\n').find(item => item.startsWith('data: '));
          if (line) return JSON.parse(line.slice(6));
          continue;
        }
        const chunk = await reader.read();
        assert.equal(chunk.done, false, 'SSE closed before receiving the message');
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}

try {
  compose(['config', '--quiet']);
  compose(['up', '-d', '--build', '--wait', '--wait-timeout', '90']);
  const address = compose(['port', 'c-lab', '8000'], true);
  const base = `http://${address}`;
  const id = compose(['ps', '-q', 'c-lab'], true);
  const inspect = () => JSON.parse(docker(['inspect', id], true))[0];
  const container = inspect();
  assert.equal(container.Config.User, 'node');
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.equal(container.State.Health.Status, 'healthy');

  const health = await request(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { ok: true });
  assert.deepEqual(await (await request(`${base}/api/info`)).json(), {
    port: 8000, addresses: [], publicOrigin: env.PUBLIC_ORIGIN,
  });
  const index = await request(base);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<html/);

  const assets = JSON.parse(compose(['exec', '-T', 'c-lab', 'node', '-e',
    "console.log(JSON.stringify(require('node:fs').readdirSync('/app/dist/assets')))"], true));
  assert.ok(assets.some(name => name.endsWith('.wasm')), 'WASM assets are packaged');
  for (const name of assets) {
    const response = await request(`${base}/assets/${encodeURIComponent(name)}`);
    assert.equal(response.status, 200, name);
    const bytes = await response.arrayBuffer();
    assert.ok(bytes.byteLength > 0, name);
    if (name.endsWith('.wasm')) {
      assert.equal(response.headers.get('content-type'), 'application/wasm');
      assert.equal(WebAssembly.validate(bytes), true, name);
    }
  }

  const room = 'ABC234';
  const key = randomUUID();
  const viewer = await subscribe(base, room);
  const publish = async message => {
    const response = await request(`${base}/api/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room, key, message }),
    });
    assert.equal(response.status, 200);
    await response.json();
  };
  const workspace = { type: 'workspace', lessonId: 'arrays', files: { 'main.c': 'int main(){return 0;}' }, input: '' };
  const step = { type: 'step', step: 2, playing: false };
  await publish(workspace);
  assert.deepEqual(await viewer.next(), workspace);
  await publish(step);
  assert.deepEqual(await viewer.next(), step);
  const late = await subscribe(base, room);
  assert.deepEqual(await late.next(), workspace);
  assert.deepEqual(await late.next(), step);
  assert.deepEqual(await (await request(`${base}/api/room?room=${room}`)).json(), { exists: true, viewers: 2 });

  // Keep SSE streams open: Docker's SIGTERM must still close them and exit cleanly.
  compose(['stop', '-t', '15', 'c-lab'], false, 30_000);
  assert.equal(inspect().State.ExitCode, 0, 'Graceful SIGTERM exit');
  while (!(await viewer.reader.read()).done) { /* drain any heartbeat */ }
  while (!(await late.reader.read()).done) { /* drain any heartbeat */ }
  console.log('Docker smoke passed: non-root/read-only runtime, health, assets/WASM, public links, SSE replay, SIGTERM.');
} catch (error) {
  process.exitCode = 1;
  console.error(error);
  try { compose(['logs', '--no-color', '--tail', '100']); } catch { /* preserve failure */ }
} finally {
  for (const stream of streams) stream.abort();
  try { compose(['down', '--rmi', 'local', '--remove-orphans'], false, 60_000); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
