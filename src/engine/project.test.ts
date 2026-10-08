import { describe, expect, it } from 'vitest';
import { runTraceAsync } from './trace';
import type { SourceFiles } from './project';

const run = (files: SourceFiles) => runTraceAsync(files['main.c'] ?? '', '', files);
const header = '#ifndef API_H\n#define API_H\nextern int count;\nint add(int n);\n#endif\n';

describe('独立翻译单元与链接', () => {
  it('links prototypes, shared extern objects and maps steps to source files', async () => {
    const trace = await run({
      'main.c': '#include <stdio.h>\n#include "api.h"\n#include "api.h"\nint main(void) {\n int value = add(3);\n printf("%d %d\\n", value, count);\n return 0;\n}',
      'api.h': header,
      'api.c': '#include "api.h"\nint count = 2;\nint add(int n) {\n count += n;\n return count;\n}\n',
    });
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe('5 5\n');
    expect(trace.snapshots.some(s => s.file === 'api.c' && s.line === 4)).toBe(true);
    expect(trace.snapshots.some(s => s.file === 'main.c' && s.line === 5)).toBe(true);
  });

  it('isolates same-named static functions and variables across units', async () => {
    const trace = await run({
      'main.c': '#include <stdio.h>\nint a(void); int b(void);\nint main(void){printf("%d %d\\n", a(), b()); return 0;}',
      'a.c': 'static int n=3; static int helper(void){return n;} int a(void){return helper();}',
      'b.c': 'static int n=7; static int helper(void){return n;} int b(void){return helper();}',
    });
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe('3 7\n');
  });

  it('does not let a later prototype erase a definition', async () => {
    const trace = await run({ 'a.c': 'int value(void){return 9;}', 'main.c': 'int value(void); int main(void){return value();}' });
    expect(trace.error).toBeUndefined();
    expect(trace.exitCode).toBe(9);
  });

  it('requires declarations in the calling unit', async () => {
    const trace = await run({ 'main.c': 'int main(void){return hidden();}', 'a.c': 'int hidden(void){return 1;}' });
    expect(trace.status).toBe('error');
    expect(trace.error).toContain('hidden');
  });

  it('keeps a private object separate from another unit’s public object of the same name', async () => {
    const trace = await run({
      'main.c': '#include <stdio.h>\nint a(void); extern int n; int main(void){printf("%d %d\\n", a(), n); return 0;}',
      'a.c': 'static int n=3; int a(void){return n;}',
      'b.c': 'int n=7;',
    });
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe('3 7\n');
  });

  it('links a block-scope extern declaration', async () => {
    const trace = await run({ 'main.c': 'int main(void){extern int n; return n;}', 'n.c': 'int n=7;' });
    expect(trace.error).toBeUndefined();
    expect(trace.exitCode).toBe(7);
  });

  it.each([
    [{ 'main.c': 'int x=1; int main(void){return x;}', 'a.c': 'int x=2;' }, '重复定义'],
    [{ 'main.c': 'extern int x; int main(void){return x;}' }, '没有定义'],
    [{ 'main.c': 'int f(int n); int main(void){return f(1);}', 'a.c': 'double f(int n){return n;}' }, '类型不一致'],
    [{ 'main.c': 'struct S { int x; }; int f(struct S *s); int main(void){return 0;}', 'a.c': 'struct S { double x; }; int f(struct S *s){return 0;}' }, '类型不一致'],
    [{ 'main.c': '#include "missing.h"\nint main(void){return 0;}' }, '找不到头文件'],
    [{ 'main.c': '#include "loop.h"', 'loop.h': '#include "loop.h"' }, '循环包含'],
    [{ 'main.c': '#line 30\nint main(void){return 0;}' }, '预处理指令'],
  ] as [SourceFiles, string][])('reports project errors', async (files, message) => {
    const trace = await run(files);
    expect(trace.status).toBe('error');
    expect(trace.error).toContain(message);
  });

  it('reports syntax errors in the original header', async () => {
    const trace = await run({ 'main.c': '#include "bad.h"\nint main(void){return 0;}', 'bad.h': '\nint = ;' });
    expect(trace.errorFile).toBe('bad.h');
    expect(trace.errorLine).toBe(2);
  });
});
