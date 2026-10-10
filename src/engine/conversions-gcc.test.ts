import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runTraceAsync } from './trace';

const program = `#include <stdio.h>

float add(float a, float b) {
    return a + b;
}

long choose(long value, unsigned int offset) {
    return value + offset;
}

int main(void) {
    int signed_value = -1;
    unsigned int unsigned_value = 1U;
    float f = 3.14f;
    int values[3] = {10, 20, 30};
    int *pointer = values;

    printf("cmp=%d %d\\n", signed_value < unsigned_value, choose(4000000000L, 1U) == 4000000001L);
    printf("sum=%.17g f=%.9f\\n", add(0.1f, 0.2f), f);
    printf("args=%d %ld\\n", (int)3.9, choose(-2L, 3U));
    printf("array=%d %d %ld\\n", *(values + 1), pointer[2], pointer + 2 - pointer);
    return 0;
}`;

it('matches GCC for integer conversions, function conversions, and float32 arithmetic', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'conversions-'));
  try {
    writeFileSync(join(dir, 'main.c'), program);
    execFileSync('gcc', ['-std=c17', '-Wall', '-Wextra', 'main.c', '-o', 'p'], { cwd: dir });
    const expected = execFileSync(join(dir, 'p'), { encoding: 'utf8' });
    const trace = await runTraceAsync(program);
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe(expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('rejects floating-point remainder instead of applying JavaScript coercion', async () => {
  const trace = await runTraceAsync('int main(void) { return (int)(1.5 % 1.0); }');
  expect(trace.status).toBe('error');
  expect(trace.error).toContain('取模运算只适用于整数');
});

it('keeps long and long long as distinct ranked types', async () => {
  const trace = await runTraceAsync('int main(void) { long a = 1L; long long b = 2LL; return (int)(a + b); }');
  const variables = trace.snapshots.flatMap(snapshot => snapshot.variables);
  expect(variables.find(variable => variable.name === 'a')?.type).toBe('long');
  expect(variables.find(variable => variable.name === 'b')?.type).toBe('long long');
});
