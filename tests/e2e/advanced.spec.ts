import { test, expect } from '@playwright/test';

test('macro lessons show expanded code, preserve original line highlighting and rerun edits', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('program-output')).toContainText('Total: 420');
  await page.getByRole('button', { name: '课程目录', exact: true }).click();
  await page.getByRole('button', { name: /宏定义与展开/ }).click();
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.getByTestId('program-output')).toContainText('score = 90');
  await expect(page.locator('.diagram-caption-right')).toContainText('第 10 行');
  await expect(page.locator('.cm-execution-line')).toContainText('CAT(score, _value)');
  await page.getByText('查看预处理结果（运行前）', { exact: true }).click();
  await page.getByText('main.c · 展开后的翻译单元', { exact: true }).click();
  await expect(page.getByLabel('main.c 预处理结果')).toContainText('score_value');
  await expect(page.getByLabel('main.c 预处理结果')).not.toContainText('#define');
  const editor = page.locator('.cm-content');
  const source = await editor.innerText();
  await editor.fill(source.replace('#define LIMIT 100', '#define LIMIT 80'));
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('program-output')).toContainText('score = 80');
  expect(errors).toEqual([]);
});

test('final chapter runs CRUD and statistics, and responds to configuration and input changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('program-output')).toContainText('Total: 420');
  await page.getByRole('button', { name: '课程目录', exact: true }).click();
  await page.getByRole('button', { name: /最终章：学生成绩管理系统/ }).click();
  const files = page.getByRole('group', { name: '源码文件' });
  await expect(files.getByRole('button')).toHaveCount(7);
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  const output = page.getByTestId('program-output');
  await expect(output).toContainText('count=3 average=84.3');
  await expect(output).toContainText('ADD DUPLICATE');
  await expect(output).toContainText('best=103 Carol 92');
  await expect(output).toContainText('DELETE OK');
  await expect(output).toContainText('UPDATE NOT_FOUND');
  await expect(output).toContainText('BYE');
  const next = page.getByRole('button', { name: '下一步', exact: true });
  for (let i = 0; i < 25; i++) {
    if (await files.getByRole('button', { name: 'service.c', exact: true }).getAttribute('aria-pressed') === 'true') break;
    await next.click();
  }
  await expect(files.getByRole('button', { name: 'service.c', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cm-execution-line')).toBeVisible();
  await page.screenshot({ path: '/tmp/opencode/student-system-desktop.png', fullPage: true });
  await files.getByRole('button', { name: 'config.h', exact: true }).click();
  const editor = page.locator('.cm-content');
  const config = await editor.innerText();
  await editor.fill(config.replace('#define CAPACITY 4', '#define CAPACITY 2').replace('#define ENABLE_STATS 1', '#define ENABLE_STATS 0'));
  await page.getByRole('button', { name: '输入', exact: true }).click();
  await page.locator('#stdin').fill('1 1 Amy 91\n1 2 Bob 60\n1 3 Cal 70\n5\n6\n0\n');
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(output).toContainText('ADD FULL');
  await expect(output).toContainText('STATS_DISABLED');
  await expect(output).toContainText('1 Amy 91');
  await expect(output).toContainText('2 Bob 60');
  await page.reload();
  await expect(output).toContainText('STATS_DISABLED');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/opencode/student-system-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
