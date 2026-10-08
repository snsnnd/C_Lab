import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runTraceAsync } from './trace';

const program = `#include <stdio.h>

typedef unsigned long long ull;

int main(void)
{
    ull a = 3524578ULL;
    ull b = 3524578ULL;

    printf("sizeof(ull) = %d\\n", (int)sizeof(ull));
    printf("a = %llu\\n", a);
    printf("b = %llu\\n", b);
    printf("a * b = %llu\\n", a * b);

    return 0;
}`;

it('unsigned long long typedef, ULL suffix and %llu match GCC', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'u64-'));
  try {
    writeFileSync(join(dir, 'main.c'), program);
    execFileSync('gcc', ['-std=c17', '-Wall', '-Wextra', 'main.c', '-o', 'p'], { cwd: dir });
    const expected = execFileSync(join(dir, 'p'), { encoding: 'utf8' });
    const trace = await runTraceAsync(program);
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe(expected);
    expect(trace.output).toContain('sizeof(ull) = 8');
    // 64-bit multiply must not be truncated to 32 bits
    expect(trace.output).not.toContain('1604658052');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
