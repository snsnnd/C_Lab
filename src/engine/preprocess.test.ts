import { expect, it } from 'vitest';
import { runTraceAsync } from './trace';
import { preprocess } from './c/preprocess';

it('expands object, nested function and alias macros while retaining invocation lines', async () => {
  const source = '#define N 3\n#define ADD(x,y) ((x)+(y))\n#define CALL ADD\nint main(void) {\n int n = CALL(ADD(N, 2), 4);\n return n;\n}';
  const trace = await runTraceAsync(source);
  expect(trace.error).toBeUndefined();
  expect(trace.exitCode).toBe(9);
  expect(trace.snapshots.some(s => s.line === 5 && s.variables.some(v => v.name === 'n' && v.value === '9'))).toBe(true);
});

it('supports continuation, multi-line macro calls, stringification, paste and variadic macros', async () => {
  const trace = await runTraceAsync(String.raw`#include <stdio.h>
#define CAT(a,b) a##b
#define STR(x) #x
#define SUM(a,b) \
 ((a)+(b))
#define LOG(fmt, ...) printf(fmt, __VA_ARGS__)
int main(void) {
 int CAT(to,tal) = SUM(
   2, 3);
 LOG("%s %d\n", STR(a + b), total);
 return 0;
}`);
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('a + b 5\n');
});

it('does not expand literal text and exposes __LINE__ and __FILE__ at the call site', async () => {
  const trace = await runTraceAsync('#include <stdio.h>\n#define N 9\n#define LINE __LINE__\nint main(void){printf("N %d %s\\n", LINE, __FILE__); return 0;}');
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('N 4 main.c\n');
});

it('evaluates conditional compilation lazily, including defined, elif, undef and nesting', async () => {
  const trace = await runTraceAsync(`#define LEVEL 2
#if defined(LEVEL) && LEVEL >= 2 && (1 || 1/0)
#define RESULT 7
#elif UNKNOWN
#error not selected
#else
#define RESULT 8
#endif
#undef LEVEL
#ifndef LEVEL
#if 0
this is invalid C and is ignored
#endif
int main(void){return RESULT;}
#endif`);
  expect(trace.error).toBeUndefined();
  expect(trace.exitCode).toBe(7);
});

it('supports include macros and recursive guarded headers without leaking macros across units', async () => {
  const files = {
    'main.c': '#define PRIVATE 99\n#define API "api.h"\n#include API\n#include API\nint main(void){return value();}',
    'api.h': '#ifndef API_H\n#define API_H\n#include "api.h"\nint value(void);\n#endif',
    'api.c': '#include "api.h"\n#ifdef PRIVATE\n#error leaked macro\n#endif\nint value(void){return 6;}',
  };
  const trace = await runTraceAsync(files['main.c'], '', files);
  expect(trace.error).toBeUndefined();
  expect(trace.exitCode).toBe(6);
  expect(trace.snapshots.some(s => s.file === 'api.c' && s.line === 5)).toBe(true);
});

it('stops recursive macro rescanning and diagnoses malformed preprocessing', () => {
  const source = '#define A B\n#define B A\nA';
  expect(preprocess({ 'main.c': source }, 'main.c').source).toBe('A');
  for (const code of ['#if 1\nint n;', '#else', '#define F(x) x\nF(1,2)', '#define X 1\n#define X 2', '#error deliberate']) {
    expect(() => preprocess({ 'main.c': code }, 'main.c')).toThrow();
  }
});

it('provides common header constants and bool, size_t and fixed-width typedefs', async () => {
  const trace = await runTraceAsync(`#include <stdio.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
int main(void) {
 bool ready = 42;
 uint8_t byte = 255;
 size_t length = 3;
 int *p = NULL;
 printf("%d %d %d %d\\n", ready, byte, (int)length, p == NULL);
 return 0;
}`);
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('1 255 3 1\n');
});

it('keeps static locals across calls and isolates declarations with the same name', async () => {
  const trace = await runTraceAsync('#include <stdio.h>\nint next(void){static int n; return ++n;}\nint other(void){static int n=10; return ++n;}\nint main(void){int a=next(); int b=next(); int c=other(); printf("%d %d %d\\n",a,b,c);return 0;}');
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('1 2 11\n');
});

it('advances scanf input, supports bounded strings, floating input and EOF', async () => {
  const trace = await runTraceAsync('#include <stdio.h>\nint main(void){int a,b; char name[8]; double score; scanf("%d",&a); scanf("%d %7s %lf",&b,name,&score); int end=scanf("%d",&a); printf("%d %d %s %.1f %d\\n",a,b,name,score,end); return 0;}', '1 2 Alice 87.5');
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('1 2 Alice 87.5 -1\n');
});

it('sscanf reads its supplied string and fgets consumes one line at a time', async () => {
  const trace = await runTraceAsync('#include <stdio.h>\nint main(void){int n; char text[8]; sscanf("42", "%d", &n); fgets(text,8,stdin); printf("%d:%s",n,text); fgets(text,8,stdin); printf("%s",text); return 0;}', 'one\ntwo\n');
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('42:one\ntwo\n');
});

it('evaluates macro array bounds and enum constant expressions, and infers array sizes', async () => {
  const trace = await runTraceAsync('#include <stdio.h>\n#define N (3 + 1)\nenum Flag { A=1<<2, B=A|2 };\nint main(void){int a[N]={1,2,3,4}; int b[]={5,6}; char s[]="ok"; printf("%d %d %d %d %s\\n",(int)sizeof(a),(int)sizeof(b),A,B,s);return 0;}');
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('16 8 4 6 ok\n');
});

it('rejects nonconstant bounds instead of silently allocating zero-length arrays', async () => {
  const trace = await runTraceAsync('int main(void){int n=3; int a[n]; return 0;}');
  expect(trace.status).toBe('error');
  expect(trace.error).toContain('整数常量表达式');
});

it('handles hexadecimal, octal, scientific notation and character escapes', async () => {
  const trace = await runTraceAsync(String.raw`#include <stdio.h>
int main(void){printf("%d %d %.1f %d %d\n",0xFF,010,1e2,'\x41','\101');return 0;}`);
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('255 8 100.0 65 65\n');
});

it('returns scanf suppression counts and the destination pointer from strcpy', async () => {
  const trace = await runTraceAsync('#include <stdio.h>\n#include <string.h>\nint main(void){char dest[4]; int n=scanf("%*d"); printf("%d %c\\n",n,strcpy(dest,"abc")[0]);return 0;}', '12');
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('0 a\n');
});
