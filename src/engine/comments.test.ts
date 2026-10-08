import { expect, it } from 'vitest';
import { runTraceAsync } from './trace';

it('accepts Chinese line/block comments between declarations, statements and expressions', async () => {
  const source = [
    '// 这是程序说明',
    '#include <stdio.h> // 输出',
    '/* 多行注释',
    '   不应改变行号 */',
    'int add(int /* 参数 */ x, int y) {',
    '  // 相加',
    '  return x /* 表达式内 */ + y;',
    '}',
    'int main(void) {',
    '  int /* 类型与名字之间 */ n = add(2, /* 实参 */ 3);',
    '  printf("%d\\n", n); // 行尾',
    '  /* 返回 */ return 0;',
    '}',
  ].join('\n');
  const trace = await runTraceAsync(source);
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('5\n');
  expect(trace.snapshots.some(s => s.line === 7)).toBe(true);
  expect(trace.snapshots.some(s => s.line === 10 && s.variables.some(v => v.name === 'n' && v.value === '5'))).toBe(true);
  expect(trace.snapshots.some(s => [1, 3, 4, 6].includes(s.line))).toBe(false);
});

it('keeps comment markers and escaped quotes inside strings', async () => {
  const trace = await runTraceAsync(String.raw`#include <stdio.h>
int main(void) {
  printf("https://example.test /* literal */ \"//\"\\n");
  return 0;
}`);
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('https://example.test /* literal */ "//"\\n');
});

it('ignores commented-out includes and allows comments on header guards and includes', async () => {
  const files = {
    'main.c': '// 入口\n#include "api.h" /* 接口 */\n#include "api.h" // 再次包含\nint main(void) { return answer(); }',
    'api.h': '/* 说明\n#include "missing.h"\n*/\n#ifndef API_H // 保护\n#define API_H /* 定义 */\nint answer(void); // 声明\n#endif // 结束\n',
    'api.c': '#include "api.h"\n/* 实现 */\nint answer(void) {\n  // 结果\n  return 42;\n}',
  };
  const trace = await runTraceAsync(files['main.c'], '', files);
  expect(trace.error).toBeUndefined();
  expect(trace.exitCode).toBe(42);
  expect(trace.snapshots.some(s => s.file === 'api.c' && s.line === 5)).toBe(true);
});

it('reports an unclosed block comment at its original line', async () => {
  const trace = await runTraceAsync('int main(void) {\n/* 忘记结束\nreturn 0; }');
  expect(trace.status).toBe('error');
  expect(trace.error).toContain('块注释未闭合');
  expect(trace.errorLine).toBe(2);
});
