import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { advancedLessons } from '../data/advancedLessons';
import { studentSystemLesson } from '../data/studentSystemLesson';
import { runTraceAsync } from './trace';

async function compare(files: Record<string, string>, input = '') {
  const directory = mkdtempSync(join(tmpdir(), 'c-lab-advanced-'));
  try {
    for (const [file, code] of Object.entries(files)) writeFileSync(join(directory, file), code);
    execFileSync('gcc', ['-std=c17', '-Wall', '-Wextra', ...Object.keys(files).filter(file => file.endsWith('.c')), '-o', 'program'], { cwd: directory });
    const expected = execFileSync(join(directory, 'program'), { encoding: 'utf8', input });
    const trace = await runTraceAsync(files['main.c'], input, Object.keys(files).length > 1 ? files : undefined);
    expect(trace.error).toBeUndefined();
    expect(trace.status).toBe('completed');
    expect(trace.output).toBe(expected);
    expect(trace.exitCode).toBe(0);
    return trace;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

it.each(advancedLessons)('$title 与 GCC 实际编译运行一致', async lesson => {
  await compare({ 'main.c': lesson.code, ...lesson.files }, lesson.input);
});

it('macro rescanning, condition signedness, static lifetime and common input match GCC', async () => {
  await compare({ 'main.c': String.raw`#include <stdio.h>
#include <stdbool.h>
#define F(x) ((x)+1)
#define ALIAS F
#define JOIN(a,b) a##b
#define SHOW(x) #x
#define LOG(...) printf(__VA_ARGS__)
#if -1 < 1U || ((1 ? -1 : 1U) < 0)
#error unsigned comparison is wrong
#elif (0 ? 1/0 : 1) && defined(__LINE__)
#define MODE 1
#else
#define MODE 0
#endif
int counter(void){static int n=0; return ++n;}
int main(void){
 int JOIN(my,_value)=ALIAS(F(2));
 int values[]={2,3,4};
 char text[]="abc";
 bool b=50;
 int x=counter(), y=counter();
 LOG("%s %d %d %d %d %d %d %s\n",SHOW(a + b),my_value,MODE,b,x,y,(int)sizeof(values),text);
 return 0;
}` });
});

it.each([
  ['empty and missing IDs', '5\n2 999\n4 999\n0\n'],
  ['invalid scores and IDs', '1 0 Zero 50\n1 1 Alice 101\n1 1 Alice 100\n3 1 -1\n2 1\n0\n'],
  ['capacity and reuse after deletion', '1 1 A 1\n1 2 B 2\n1 3 C 3\n1 4 D 4\n1 5 E 5\n4 2\n1 5 E 5\n6\n0\n'],
  ['bad and exhausted input', '1 1 Alice nope\n'],
  ['unknown command', '99\n0\n'],
  ['EOF without explicit exit', '1 1 Alice 50\n'],
])('final system: %s matches GCC', async (_title, input) => {
  await compare({ 'main.c': studentSystemLesson.code, ...studentSystemLesson.files }, input);
});

it('final system respects the conditional statistics switch', async () => {
  const files: Record<string, string> = { 'main.c': studentSystemLesson.code, ...studentSystemLesson.files };
  files['config.h'] = files['config.h'].replace('#define ENABLE_STATS 1', '#define ENABLE_STATS 0');
  const trace = await compare(files, '5\n0\n');
  expect(trace.output).toContain('STATS_DISABLED');
});
