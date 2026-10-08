import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { architectureLessons } from '../data/architectureLessons';
import { runTraceAsync } from './trace';

it.each(architectureLessons)('$title 的多单元结果与 GCC 一致', async lesson => {
  const files = { ...lesson.files, 'main.c': lesson.code };
  const directory = mkdtempSync(join(tmpdir(), 'c-lab-modules-'));
  try {
    for (const [file, source] of Object.entries(files)) writeFileSync(join(directory, file), source);
    execFileSync('gcc', ['-std=c17', '-Wall', '-Wextra', ...Object.keys(files).filter(file => file.endsWith('.c')), '-o', 'program'], { cwd: directory });
    const expected = execFileSync(join(directory, 'program'), { encoding: 'utf8' });
    const trace = await runTraceAsync(lesson.code, lesson.input, files);
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe(expected);
    expect(trace.exitCode).toBe(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
