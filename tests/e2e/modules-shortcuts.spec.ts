import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('playback shortcuts respect editing, modal focus and stale traces', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('program-output')).toContainText('Total: 420');
  await page.getByRole('button', { name: '回到第一步' }).click();
  const counter = page.locator('.step-counter strong');
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('2');
  await page.keyboard.press('Shift+Space');
  await expect(counter).toHaveText('1');
  await page.keyboard.press('End');
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
  await page.keyboard.press('Home');
  await expect(counter).toHaveText('1');
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '暂停播放' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '播放执行过程' })).toBeVisible();

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: '键盘快捷键' })).toBeVisible();
  const before = await counter.textContent();
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText(before!);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(counter).not.toHaveText(before!);
  const at = await counter.textContent();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('Space');
  await expect(counter).toHaveText(at!);
  await expect(page.locator('.stale-banner')).toBeVisible();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(counter).toHaveText(at!);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('.stale-banner')).toHaveCount(0);
  await expect(counter).toHaveText('1');
  await editor.fill('int main(void) { while (1) {} return 0; }');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.keyboard.press('ControlOrMeta+.');
  await expect(page.getByRole('button', { name: '停止执行' })).toHaveCount(0);
  await page.getByRole('button', { name: '诊断', exact: true }).click();
  await expect(page.locator('.diagnostic')).toContainText('已停止本次执行');
  expect(errors).toEqual([]);
});

test('architecture projects execute, switch source on replay, persist and export all files', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('program-output')).toContainText('Total: 420');
  await page.getByRole('button', { name: '课程目录', exact: true }).click();
  await page.getByRole('button', { name: /从单文件到模块/ }).click();
  const files = page.getByRole('group', { name: '源码文件' });
  await expect(files.getByRole('button')).toHaveCount(3);
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.getByTestId('program-output')).toHaveText('total = 12\n');
  const next = page.getByRole('button', { name: '下一步', exact: true });
  for (let i = 0; i < 15; i++) {
    if (await files.getByRole('button', { name: 'stats.c', exact: true }).getAttribute('aria-pressed') === 'true') break;
    await next.click();
  }
  await expect(files.getByRole('button', { name: 'stats.c', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cm-execution-line')).toBeVisible();
  await expect(page.getByLabel('模块关系')).toContainText('stats.c');
  await page.getByRole('button', { name: '回到第一步' }).click();
  await expect(files.getByRole('button', { name: 'main.c', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await files.getByRole('button', { name: 'stats.c', exact: true }).click();
  await page.locator('.cm-content').fill('#include "stats.h"\nint sum(int *values, int count) { return 99; }\n');
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.getByTestId('program-output')).toHaveText('total = 99\n');
  await page.reload();
  await expect(page.getByTestId('program-output')).toHaveText('total = 99\n');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 C 源码' }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toBe('modules.json');

  await page.getByRole('button', { name: '新增文件' }).click();
  await page.getByRole('textbox', { name: '文件名' }).fill('extra.c');
  await page.getByRole('button', { name: '保存文件名' }).click();
  await expect(files.getByRole('button', { name: 'extra.c', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重命名文件' }).click();
  await page.getByRole('textbox', { name: '文件名' }).fill('helper.c');
  await page.getByRole('button', { name: '保存文件名' }).click();
  await expect(files.getByRole('button', { name: 'helper.c', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除文件', exact: true }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(files.getByRole('button')).toHaveCount(3);
  await page.getByRole('button', { name: '恢复示例', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '恢复示例' }).click();
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.getByTestId('program-output')).toHaveText('total = 12\n');

  await page.locator('input[type=file]').setInputFiles({ name: 'modules.json', mimeType: 'application/json', buffer: await readFile((await exported.path())!) });
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.getByTestId('program-output')).toHaveText('total = 99\n');
  await page.screenshot({ path: '/tmp/opencode/modules-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/opencode/modules-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('encapsulation, layered services and injected strategies run in the browser worker', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('program-output')).toContainText('Total: 420');
  for (const [title, output] of [
    ['封装与状态所有权', 'stock = 2, requests = 2'],
    ['分层与依赖方向', 'available = 6'],
    ['用接口替换策略', 'prices = 100 80'],
  ]) {
    await page.getByRole('button', { name: '课程目录', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(title) }).click();
    await page.getByRole('button', { name: '运行代码', exact: false }).click();
    await expect(page.getByTestId('program-output')).toContainText(output);
  }
  expect(errors).toEqual([]);
});
