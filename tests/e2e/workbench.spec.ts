import { test, expect, type Page } from '@playwright/test';

async function editCode(page: Page, code: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await editor.press('ControlOrMeta+a');
  await editor.pressSequentially(code, { delay: 0 });
}

test('browser worker executes, diagram plays back, edits change real output', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('program-output')).toContainText('Total: 420', { timeout: 15000 });
  await expect(page.getByLabel('数组 scores')).toBeVisible();
  await page.getByRole('button', { name: '跳到最后一步' }).click();
  await expect(page.getByTestId('variable-sum').locator('.variable-value')).toHaveText('420');
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await page.getByRole('button', { name: '回到第一步' }).click();
  await page.getByRole('button', { name: '播放执行过程' }).click();
  await expect(page.getByRole('button', { name: '暂停播放' })).toBeVisible();
  await page.getByRole('button', { name: '暂停播放' }).click();
  await editCode(page, '#include <stdio.h>\nint main(){int my_value=21; printf("%d",my_value*2);return 0;}');
  await expect(page.locator('.stale-banner')).toBeVisible();
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.getByTestId('program-output')).toHaveText('42');
  await page.getByRole('button', { name: '跳到最后一步' }).click();
  await expect(page.getByTestId('variable-my_value')).toContainText('21');
  expect(errors).toEqual([]);
});

test('lessons, stdin, saved drafts, notes and error diagnostics', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('program-output')).toContainText('Total: 420');
  await page.getByRole('button', { name: '课程目录', exact: true }).click();
  await page.getByRole('button', { name: /输入与交互/ }).click();
  await page.getByLabel('运行前输入数据').fill('18 24');
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.getByTestId('program-output')).toHaveText('sum = 42\n');
  await page.reload();
  await expect(page.getByTestId('program-output')).toHaveText('sum = 42\n');
  await page.getByRole('tab', { name: '本课讲义' }).click();
  await page.getByRole('button', { name: '看看参考解释' }).click();
  await expect(page.locator('.answer')).toBeVisible();
  await page.getByRole('button', { name: '我能解释这个过程，标记学完' }).click();
  await expect(page.getByRole('button', { name: '已学完本课 · 点击撤销' })).toBeVisible();
  await page.getByRole('tab', { name: '代码实验' }).click();
  await editCode(page, 'int main(){int x = ; return 0;}');
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.locator('.diagnostic.error')).toBeVisible();
});

test('desktop, dark, mobile and presentation visual inspection', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('program-output')).toContainText('Total: 420');
  await page.screenshot({ path: '/tmp/opencode/c-lab-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '切换深色主题' }).click();
  await page.screenshot({ path: '/tmp/opencode/c-lab-dark.png', fullPage: true });
  await page.getByRole('button', { name: '切换浅色主题' }).click();
  await page.getByRole('button', { name: '切换投屏模式' }).click();
  await page.screenshot({ path: '/tmp/opencode/c-lab-presentation.png', fullPage: true });
  await page.getByRole('button', { name: '切换投屏模式' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '可视化', exact: true }).click();
  await expect(page.getByLabel('数组 scores')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/opencode/c-lab-mobile.png', fullPage: true });
});

test('struct, enum and callback lessons render real fields and callbacks', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('program-output')).toContainText('Total: 420');

  await page.getByRole('button', { name: '课程目录', exact: true }).click();
  await page.getByRole('button', { name: /结构体指针/ }).click();
  await page.getByLabel('输入').click().catch(() => {});
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.getByTestId('program-output')).toContainText('after by pointer: 97', { timeout: 15000 });
  await page.getByRole('button', { name: '跳到最后一步' }).click();
  await expect(page.getByTestId('record-s').locator('.field-value').first()).toBeVisible();

  await page.getByRole('button', { name: '课程目录', exact: true }).click();
  await page.getByRole('button', { name: /枚举与状态/ }).click();
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.getByTestId('program-output')).toContainText('now = 2', { timeout: 15000 });

  await page.getByRole('button', { name: '课程目录', exact: true }).click();
  await page.getByRole('button', { name: /回调：把规则交给调用者/ }).click();
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.getByTestId('program-output')).toContainText('asc : 10 20 30', { timeout: 15000 });
  await expect(page.getByTestId('program-output')).toContainText('desc: 30 20 10');
  // Step into the callback so the nested call layer and the pointer parameter appear.
  const next = page.getByRole('button', { name: '下一步' });
  for (let i = 0; i < 25; i++) {
    if (await page.locator('section[aria-label="函数调用"]').count()) break;
    await next.click();
  }
  await expect(page.locator('section[aria-label="函数调用"]')).toBeVisible();
  // The comparator parameter is a function pointer pointing at the chosen rule.
  for (let i = 0; i < 20; i++) {
    if (await page.locator('section[aria-label="指向关系"]').count()) break;
    await next.click();
  }
  await expect(page.locator('section[aria-label="指向关系"]')).toBeVisible();
  await page.screenshot({ path: '/tmp/opencode/c-lab-callback.png' });
  expect(errors).toEqual([]);
});

test('line highlight follows each stop and control-flow decisions are shown', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('program-output')).toContainText('Total: 420');

  const code = [
    '#include <stdio.h>',
    'int main(void) {',
    '  int i = 0, total = 0;',
    '  while (i < 3) {',
    '    switch (i) {',
    '      case 0: total += 5; break;',
    '      case 1: total += 1; break;',
    '      default: total += 100; break;',
    '    }',
    '    i++;',
    '  }',
    '  printf("%d\\n", total);',
    '  return 0;',
    '}',
    '',
  ].join('\n');
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await editor.pressSequentially(code, { delay: 5 });
  await page.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(page.getByTestId('program-output')).toContainText('6', { timeout: 20000 });

  const highlightedLine = () => page.evaluate(() => {
    const lines = [...document.querySelectorAll('.cm-line')];
    const index = lines.findIndex(el => el.classList.contains('cm-execution-line'));
    return index + 1;
  });
  const stopLine = async () => Number(((await page.locator('.diagram-caption-right').textContent()) ?? '').replace(/\D/g, ''));

  const seen = new Set<number>();
  const next = page.getByRole('button', { name: '下一步' });
  // The highlighted source line and the stop the diagram reports must agree.
  expect(await highlightedLine()).toBe(await stopLine());
  for (let i = 0; i < 14 && await next.isEnabled(); i++) {
    seen.add(await highlightedLine());
    expect(await highlightedLine()).toBe(await stopLine());
    await next.click();
    await page.waitForTimeout(50);
  }
  // The highlight has to actually move across the program.
  expect(seen.size).toBeGreaterThanOrEqual(5);
  expect([...seen].some(line => line > 3)).toBe(true);

  // Walk to a switch decision and check the branch panel.
  await page.getByRole('button', { name: '回到第一步' }).click();
  for (let i = 0; i < 30; i++) {
    const text = await page.getByTestId('control-result').count()
      ? await page.getByTestId('control-result').textContent()
      : '';
    if (text.includes('switch')) break;
    await next.click();
  }
  await expect(page.getByTestId('control-result')).toContainText('命中 case');
  await expect(page.locator('.control-branch.is-taken')).toContainText('case 0');
  await expect(page.locator('.control-branch:not(.is-taken)')).toHaveCount(2);
  await page.screenshot({ path: '/tmp/opencode/c-lab-control.png' });

  // A loop decision reports its round.
  await page.getByRole('button', { name: '回到第一步' }).click();
  for (let i = 0; i < 30; i++) {
    const text = await page.getByTestId('control-result').count()
      ? await page.getByTestId('control-result').textContent()
      : '';
    if (text.includes('条件成立')) break;
    await next.click();
  }
  await expect(page.locator('.control-round')).toContainText('第');
  expect(errors).toEqual([]);
});
