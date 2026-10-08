import { describe, expect, it } from 'vitest';
import { lessons } from './lessons';
import { runTraceAsync } from '../engine/trace';

describe('全部课程都通过真实执行验证', () => {
  for (const lesson of lessons) {
    it(`${lesson.number} ${lesson.title}`, async () => {
      const files: Record<string, string> | undefined = lesson.files ? { 'main.c': lesson.code, ...lesson.files } : undefined;
      const trace = await runTraceAsync(lesson.code, lesson.input, files);
      expect(trace.error, `第 ${lesson.id} 课执行报错`).toBeUndefined();
      expect(trace.status).toBe('completed');
      expect(trace.output, `第 ${lesson.id} 课输出不符`).toBe(lesson.expected);
      expect(trace.snapshots.length).toBeGreaterThan(0);
      expect(trace.snapshots.every(s => s.line >= 1 && s.line <= (files?.[s.file ?? 'main.c'] ?? lesson.code).split('\n').length)).toBe(true);
    });
  }
});
