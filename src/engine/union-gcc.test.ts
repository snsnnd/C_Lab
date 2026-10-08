import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runTraceAsync } from './trace';

// The user's exact program: union member aliasing must match real GCC output.
const unionProgram = `#include <stdio.h>
#include <string.h>

union Data
{
   int i;
   float f;
   char  str[20];
};

int main( )
{
   union Data data;

   data.i = 10;
   data.f = 220.5;
   strcpy( data.str, "C Programming");

   printf( "data.i : %d\\n", data.i);
   printf( "data.f : %f\\n", data.f);
   printf( "data.str : %s\\n", data.str);

   return 0;
}`;

it('union members share offset 0 and alias exactly like GCC', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'c-lab-union-'));
  try {
    writeFileSync(join(directory, 'main.c'), unionProgram);
    execFileSync('gcc', ['-std=c17', '-Wall', '-Wextra', 'main.c', '-o', 'program'], { cwd: directory });
    const expected = execFileSync(join(directory, 'program'), { encoding: 'utf8' });
    const trace = await runTraceAsync(unionProgram);
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe(expected);
    // sizeof(union Data) = 20 (largest member char[20], aligned to 4)
    expect(trace.layouts?.find(l => l.name === 'Data')?.size).toBe(20);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
