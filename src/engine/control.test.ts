import { describe, expect, it } from 'vitest';
import { runTraceAsync } from './trace';

describe('stop lines', () => {
  it('maps each stop to its own source line', async () => {
    const source = [
      '#include <stdio.h>', // 1
      'int main(void) {', // 2
      '  int a = 1;', // 3
      '  a = a + 1;', // 4
      '  if (a > 1) a = 5;', // 5
      '  return 0;', // 6
      '}',
      '',
    ].join('\n');
    const trace = await runTraceAsync(source);
    expect(trace.status).toBe('completed');
    expect(trace.snapshots.map(s => s.line)).toEqual([3, 4, 5, 5, 6]);
  });

  it('reports the line of a runtime error', async () => {
    const source = 'int main(void) {\n  int a = 0;\n  return a / a;\n}\n';
    const trace = await runTraceAsync(source);
    expect(trace.status).toBe('error');
    expect(trace.errorLine).toBe(3);
  });
});

describe('control-flow decisions', () => {
  it('records which branch an if took', async () => {
    const trace = await runTraceAsync('int main(void) {\n  int a = 1;\n  if (a > 0) a = 2;\n  else a = 3;\n  return 0;\n}\n');
    const decision = trace.snapshots.find(s => s.control?.construct === 'if');
    expect(decision?.control?.result).toBe('条件成立，执行 if 分支。');
    expect(decision?.control?.branches).toEqual([
      { label: 'if 分支', taken: true },
      { label: 'else 分支', taken: false },
    ]);
    expect(decision?.line).toBe(3);
  });

  it('records every loop round and the exit check', async () => {
    const source = 'int main(void) {\n  int i = 0;\n  while (i < 3) i++;\n  return 0;\n}\n';
    const trace = await runTraceAsync(source);
    const loops = trace.snapshots.filter(s => s.control?.construct === 'while');
    expect(loops.map(s => s.control!.iteration)).toEqual([1, 2, 3, 3]);
    expect(loops.at(-1)?.control?.result).toBe('条件不成立，结束循环（已执行 3 轮）。');
    expect(loops.at(-1)?.control?.branches).toEqual([
      { label: '循环体', taken: false },
      { label: '循环之后', taken: true },
    ]);
    expect(trace.snapshots.map(s => s.line)).toContain(3);
  });

  it('lists every case and greys out the ones not taken', async () => {
    const source = [
      'int main(void) {',
      '  int n = 2;',
      '  int total = 0;',
      '  switch (n) {',
      '    case 1: total = 10; break;',
      '    case 2: total = 20; break;',
      '    default: total = 99;',
      '  }',
      '  return total;',
      '}',
      '',
    ].join('\n');
    const trace = await runTraceAsync(source);
    const decision = trace.snapshots.find(s => s.control?.construct === 'switch');
    expect(decision?.line).toBe(4);
    expect(decision?.control?.result).toBe('switch(2) 命中 case 2，从这里开始执行。');
    expect(decision?.control?.branches).toEqual([
      { label: 'case 1', taken: false },
      { label: 'case 2', taken: true },
      { label: 'default', taken: false },
    ]);
    expect(trace.status).toBe('completed');
    expect(trace.exitCode).toBe(20);
  });

  it('shows the default path when nothing matches', async () => {
    const source = [
      'int main(void) {',
      '  int n = 7;',
      '  switch (n) {',
      '    case 1: n = 10; break;',
      '    default: n = 99;',
      '  }',
      '  return n;',
      '}',
      '',
    ].join('\n');
    const trace = await runTraceAsync(source);
    const decision = trace.snapshots.find(s => s.control?.construct === 'switch');
    expect(decision?.control?.result).toBe('switch(7) 没有匹配的 case，执行 default。');
    expect(decision?.control?.branches).toEqual([
      { label: 'case 1', taken: false },
      { label: 'default', taken: true },
    ]);
    expect(trace.exitCode).toBe(99);
  });
});
