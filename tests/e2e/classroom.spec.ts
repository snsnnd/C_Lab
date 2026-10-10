import { spawn, type ChildProcess } from 'node:child_process';
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:4399';
let child: ChildProcess;

test.beforeAll(async () => {
  child = spawn(process.execPath, ['server/serve.mjs'], {
    env: { ...process.env, PORT: '4399', HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${BASE}/api/room?room=AAAAAA`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error('课堂同步服务未能启动');
});

test.afterAll(() => { child?.kill(); });

test('teacher shares and students follow lesson, code, steps and read-only mode', async ({ browser }) => {
  test.setTimeout(90000);
  const teacher = await browser.newPage();
  const student = await browser.newPage();
  const errors: string[] = [];
  for (const page of [teacher, student]) {
    page.on('pageerror', error => errors.push(error.message));
  }

  await teacher.goto(BASE + '/');
  await teacher.getByTestId('program-output').filter({ hasText: 'Total: 420' }).waitFor();
  await teacher.getByRole('button', { name: '课堂同步' }).click();
  await teacher.getByTestId('start-share').click();
  const room = (await teacher.getByTestId('room-code').textContent())!;
  expect(room).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  // The teacher is on 127.0.0.1; the shown link must use a LAN address when the
  // server has one, otherwise student devices cannot open it.
  const info = await (await fetch(`${BASE}/api/info`)).json();
  const link = (await teacher.getByTestId('join-link').textContent())!;
  expect(link).toContain(`?join=${room}`);
  if (info.addresses.length) expect(link).toContain(info.addresses[0]);
  else expect(link).toContain('127.0.0.1');

  await student.goto(`${BASE}/?join=${room}`);
  await expect(student.getByTestId('follow-banner')).toContainText(room);
  await expect(student.getByTestId('program-output')).toContainText('Total: 420');
  await expect(teacher.getByTestId('viewers')).toContainText('1 位学生');
  await expect(student.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await expect(student.getByRole('button', { name: /运行代码/ })).toBeDisabled();
  await teacher.getByRole('button', { name: '关闭课堂同步' }).click();

  // Step by step playback on the teacher side moves the student's playback too.
  await teacher.getByRole('button', { name: '回到第一步' }).click();
  await teacher.getByRole('button', { name: '下一步', exact: true }).click();
  await teacher.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(student.locator('.step-counter strong')).toHaveText('3');

  // Switching lesson and running it keeps the student on the same lesson and output.
  await teacher.getByRole('button', { name: '课程目录', exact: true }).click();
  await teacher.getByRole('button', { name: /宏定义与展开/ }).click();
  await teacher.getByRole('button', { name: '运行代码', exact: false }).click();
  await expect(teacher.getByTestId('program-output')).toContainText('score = 90');
  await expect(student.locator('h1')).toHaveText('宏定义与展开');
  await expect(student.getByTestId('program-output')).toContainText('score = 90');
  await student.screenshot({ path: '/tmp/opencode/classroom-follow.png' });

  // Live editing on the teacher side reaches the student's editor.
  await teacher.locator('.cm-content').click();
  await teacher.keyboard.press('ControlOrMeta+a');
  await teacher.locator('.cm-content').pressSequentially('#include <stdio.h>\nint main(void){printf("live %d\\n", 7); return 0;}', { delay: 4 });
  await teacher.keyboard.press('ControlOrMeta+Enter');
  await expect(student.getByTestId('program-output')).toContainText('live 7');
  await expect(student.locator('.cm-content')).toContainText('live %d');

  // Leaving follow mode unlocks local editing.
  await student.getByTestId('leave-follow').click();
  await expect(student.getByTestId('follow-banner')).toHaveCount(0);
  await expect(student.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  await teacher.getByRole('button', { name: '课堂同步' }).click();
  await expect(teacher.getByTestId('viewers')).toContainText('还没有学生加入');
  expect(errors).toEqual([]);
});

test('uses the configured public origin for the displayed classroom link', async ({ page }) => {
  await page.route('**/api/info', route => route.fulfill({
    json: { port: 8000, addresses: [], publicOrigin: 'https://clab.example.com:8443' },
  }));
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: '课堂同步' }).click();
  await page.getByTestId('start-share').click();
  const room = await page.getByTestId('room-code').textContent();
  await expect(page.getByTestId('join-link')).toHaveText(`https://clab.example.com:8443/?join=${room}`);
});

test('joining a classroom backs up local drafts, and leaving or reopening restores them', async ({ browser }) => {
  test.setTimeout(90000);
  const teacher = await browser.newPage();
  const student = await browser.newPage();
  await teacher.goto(BASE + '/');
  await teacher.getByTestId('program-output').filter({ hasText: 'Total: 420' }).waitFor();
  await teacher.getByRole('button', { name: '课堂同步' }).click();
  await teacher.getByTestId('start-share').click();
  const room = (await teacher.getByTestId('room-code').textContent())!;
  await teacher.getByRole('button', { name: '关闭课堂同步' }).click();

  // The student owns a modified local draft before joining.
  await student.goto(BASE + '/');
  await student.getByTestId('program-output').filter({ hasText: 'Total: 420' }).waitFor();
  const editor = student.locator('.cm-content');
  await editor.click();
  await student.keyboard.press('ControlOrMeta+a');
  await editor.pressSequentially('#include <stdio.h>\nint main(void){printf("mine 777\\n"); return 0;}', { delay: 4 });
  await student.keyboard.press('ControlOrMeta+Enter');
  await expect(student.getByTestId('program-output')).toContainText('mine 777');

  // Joining replaces the draft with the teacher's classroom state.
  await student.getByRole('button', { name: '课堂同步' }).click();
  await student.getByLabel('课堂码').fill(room);
  await student.getByRole('button', { name: '加入', exact: true }).click();
  await expect(student.getByTestId('follow-banner')).toContainText(room);
  await expect(student.locator('.cm-content')).not.toContainText('mine 777');
  await expect(student.getByTestId('program-output')).toContainText('Total: 420');

  // Leaving restores the student's own code and clears the backup.
  await student.getByTestId('leave-follow').click();
  await expect(student.locator('.cm-content')).toContainText('mine 777');
  await student.keyboard.press('ControlOrMeta+Enter');
  await expect(student.getByTestId('program-output')).toContainText('mine 777');
  expect(await student.evaluate(() => localStorage.getItem('c-lab-classroom-backup-v1'))).toBeNull();

  // Closed mid-class without leaving: reopening the app recovers the draft.
  await student.getByRole('button', { name: '课堂同步' }).click();
  await student.getByLabel('课堂码').fill(room);
  await student.getByRole('button', { name: '加入', exact: true }).click();
  await expect(student.getByTestId('follow-banner')).toBeVisible();
  await student.goto(BASE + '/');
  await expect(student.locator('.cm-content')).toContainText('mine 777');
  await expect(student.getByTestId('follow-banner')).toHaveCount(0);
  expect(await student.evaluate(() => localStorage.getItem('c-lab-classroom-backup-v1'))).toBeNull();
});
