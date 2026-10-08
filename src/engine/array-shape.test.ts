import { expect, it } from 'vitest';
import { runTraceAsync } from './trace';
import { advancedLessons } from '../data/advancedLessons';

it('two-dimensional arrays expose shape and row-major elements', async () => {
  const lesson = advancedLessons.find(l => l.id === 'matrix')!;
  const trace = await runTraceAsync(lesson.code, lesson.input);
  const withShape = trace.snapshots.filter(s => s.variables.some(v => v.name === 'transpose' && v.shape)).at(-1);
  const transpose = withShape?.variables.find(v => v.name === 'transpose');
  expect(transpose?.shape).toEqual([3, 2]);
  expect(transpose?.elements).toEqual(['1', '4', '2', '5', '3', '6']);
  const a = withShape?.variables.find(v => v.name === 'a');
  expect(a?.shape).toEqual([2, 3]);
  expect(a?.elements).toEqual(['1', '2', '3', '4', '5', '6']);
});

it('one-dimensional arrays keep the flat strip without a shape', async () => {
  const trace = await runTraceAsync('#include <stdio.h>\nint main(void){int a[3] = {1, 2, 3}; a[1] = 9; return 0;}');
  const arr = trace.snapshots.at(-1)?.variables.find(v => v.kind === 'array');
  expect(arr?.elements).toEqual(['1', '9', '3']);
  expect(arr?.shape).toBeUndefined();
});
