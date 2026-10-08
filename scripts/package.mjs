// Build the distributable ZIP from dist/ plus launcher scripts and instructions.
// Usage: npm run build && node scripts/package.mjs
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('缺少 dist/index.html，请先运行 npm run build。');
  process.exit(1);
}
const extras = join(root, 'scripts', 'dist-extras');
const server = join(root, 'server');
const date = new Date().toISOString().slice(0, 10);
const name = `C-Lab-web-${date}`;
const stage = join(root, 'release', name);
const release = join(root, 'release');

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(dist, stage, { recursive: true });
cpSync(extras, stage, { recursive: true });
cpSync(server, join(stage, 'server'), { recursive: true });
chmodSync(join(stage, 'start-linux-mac.sh'), 0o755);
chmodSync(join(stage, 'classroom-sync-linux-mac.sh'), 0o755);

const archive = join(release, `${name}.zip`);
rmSync(archive, { force: true });
try {
  execFileSync('zip', ['-r', '-q', archive, name], { cwd: release });
  const size = (statSync(archive).size / 1024).toFixed(0);
  console.log(`已生成 release/${name}.zip（${size} KB，共 ${readdirSync(join(stage, 'assets')).length + 4} 个文件条目）`);
  console.log(`解压后目录：${name}/，包含 index.html、assets/、启动脚本与使用说明。`);
} catch {
  console.error('未找到 zip 命令。可改用：tar -czf release/' + name + '.tar.gz -C release ' + name);
  process.exit(1);
}
