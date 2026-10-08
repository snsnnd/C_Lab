import { expect, it } from 'vitest';
import { runTraceAsync } from './trace';

const program = `#include <stdio.h>
int square(int n) { return n * n; }
void greet(void) { printf("hi\\n"); }
int main(void) {
    int r = square(7);
    greet();
    printf("%d\\n", r);
    return 0;
}`;

it('return values land on the stop that returned them', async () => {
  const trace = await runTraceAsync(program);
  const stop = trace.snapshots.find(s => s.returned);
  expect(stop?.returned).toEqual({ name: 'square', value: '49' });
});

it('void functions carry no return value', async () => {
  const trace = await runTraceAsync(program);
  expect(trace.snapshots.filter(s => s.returned?.name === 'greet')).toEqual([]);
});

it('works across translation units as well', async () => {
  const files = { 'main.c': 'int value(void); int main(void){int r = value(); printf("%d", r); return 0;}', 'v.c': 'int value(void){return 9;}' };
  const trace = await runTraceAsync(files['main.c'], '', files);
  expect(trace.snapshots.some(s => s.returned?.name === 'value' && s.returned?.value === '9')).toBe(true);
});
