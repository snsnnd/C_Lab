import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runTraceAsync } from './trace';

// One program touching every common type; engine must match GCC byte for byte.
const program = `#include <stdio.h>
#include <stdbool.h>

int main(void) {
    char c = 'A';
    signed char sc = -5;
    unsigned char uc = 200;
    short s = -300;
    unsigned short us = 65000;
    int i = -100000;
    unsigned int ui = 4000000000u;
    long l = -123456789012L;
    unsigned long ul = 18000000000UL;
    long long ll = -4500000000000000LL;
    unsigned long long ull = 4500000000000000ULL;
    float f = 3.14f;
    double d = 2.5e-3;
    bool b = true;

    printf("c=%c sc=%d uc=%u\\n", c, sc, uc);
    printf("s=%d us=%u\\n", s, us);
    printf("i=%d ui=%u\\n", i, ui);
    printf("l=%lld ul=%llu\\n", l, ul);
    printf("ll=%lld ull=%llu\\n", ll, ull);
    printf("f=%.2f d=%.4f b=%d\\n", f, d, b);
    printf("half=%.1f cast=%d\\n", f / 2, (int)d);
    printf("sizes=%d,%d,%d,%d\\n", (int)sizeof(char), (int)sizeof(short), (int)sizeof(double), (int)sizeof(long long));
    return 0;
}`;

it('every common variable type matches GCC', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'types-'));
  try {
    writeFileSync(join(dir, 'main.c'), program);
    execFileSync('gcc', ['-std=c17', '-Wall', '-Wextra', 'main.c', '-o', 'p'], { cwd: dir });
    const expected = execFileSync(join(dir, 'p'), { encoding: 'utf8' });
    const trace = await runTraceAsync(program);
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe(expected);
    expect(trace.output).toContain('f=3.14');
    expect(trace.output).toContain('half=1.6 cast=0');
    const floatVariable = trace.snapshots
      .flatMap(snapshot => snapshot.variables)
      .find(variable => variable.name === 'f');
    const doubleVariable = trace.snapshots
      .flatMap(snapshot => snapshot.variables)
      .find(variable => variable.name === 'd');
    expect(floatVariable?.value).toBe('3.14');
    expect(doubleVariable?.value).toBe('0.0025');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
