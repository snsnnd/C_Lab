import { describe, expect, it } from 'vitest';
import { runTraceAsync } from './trace';

/**
 * End-to-end stop sequence: every change is attributed to the line that caused
 * it, control decisions get their own stop, and control transfer is explained.
 */
describe('stop sequence', () => {
  it('attributes each change to its own line', async () => {
    const source = [
      '#include <stdio.h>',
      'int main(void) {',
      '  int i = 0;',
      '  int total = 0;',
      '  while (i < 4) {',
      '    switch (i % 2) {',
      '      case 0: total += 10; break;',
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
    const trace = await runTraceAsync(source);
    expect(trace.status).toBe('completed');
    expect(trace.output).toBe('22\n');
    expect(trace.snapshots.map(s => `${s.line}|${s.description}`)).toEqual([
      '3|i = 0',
      '4|total = 0',
      '5|条件成立，进入第 1 轮循环。',
      '6|switch(0) 命中 case 0，从这里开始执行。',
      '7|total：0 → 10',
      '7|break 生效：直接离开当前的 switch 或循环，继续执行它后面的语句。',
      '11|i：0 → 1',
      '5|条件成立，进入第 2 轮循环。',
      '6|switch(1) 命中 case 1，从这里开始执行。',
      '8|total：10 → 11',
      '8|break 生效：直接离开当前的 switch 或循环，继续执行它后面的语句。',
      '11|i：1 → 2',
      '5|条件成立，进入第 3 轮循环。',
      '6|switch(0) 命中 case 0，从这里开始执行。',
      '7|total：11 → 21',
      '7|break 生效：直接离开当前的 switch 或循环，继续执行它后面的语句。',
      '11|i：2 → 3',
      '5|条件成立，进入第 4 轮循环。',
      '6|switch(1) 命中 case 1，从这里开始执行。',
      '8|total：21 → 22',
      '8|break 生效：直接离开当前的 switch 或循环，继续执行它后面的语句。',
      '11|i：3 → 4',
      '5|条件不成立，结束循环（已执行 4 轮）。',
      '13|程序产生了新的标准输出。',
      '14|程序结束，返回 0。',
    ]);
  });

  it('keeps stops for statements that change nothing but transfer control', async () => {
    const source = 'int main(void) {\n  int i = 0;\n  while (i < 10) {\n    i++;\n    if (i > 2) break;\n  }\n  return i;\n}\n';
    const trace = await runTraceAsync(source);
    const descriptions = trace.snapshots.map(s => s.description);
    expect(descriptions.some(d => d.startsWith('break 生效'))).toBe(true);
    expect(trace.exitCode).toBe(3);
  });
});
