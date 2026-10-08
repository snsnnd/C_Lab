import { expect, it } from 'vitest';
import { runTraceAsync } from './trace';

const program = `#include <stdio.h>
int main(void) {
    for (int i = 0; i < 800; i++) {
        if (i % 400 == 0) printf("mark %d\\n", i);
    }
    printf("end\\n");
    return 0;
}`;

it('long runs keep recording with a sliding buffer', async () => {
  const trace = await runTraceAsync(program);
  expect(trace.status).toBe('completed');
  // for-cond + i++ + if ≈ 3 stops per round → well past the 1500 window
  expect(trace.totalSnapshots).toBeGreaterThan(1500);
  expect(trace.droppedSnapshots).toBeGreaterThan(0);
  expect(trace.snapshots.length).toBe(1500);
  // the most recent steps survive: the final stop still shows the program end
  expect(trace.snapshots.at(-1)?.output).toContain('end');
});
