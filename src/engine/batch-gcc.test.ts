import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runTraceAsync } from './trace';

type BatchCase = {
  name: string;
  source: string;
  input?: string;
  files?: Record<string, string>;
  output: 'exact' | 'numbers';
};

const cases: BatchCase[] = [
  {
    name: 'integer literals promotions and ranks',
    output: 'exact',
    source: String.raw`#include <stdio.h>
int main(void) {
    signed char c = -3;
    unsigned short us = 65530;
    unsigned int u = 4000000000U;
    long l = 4000000000L;
    unsigned long long big = 9000000000000ULL;
    printf("%d %u %u %ld %llu %d %d\n", c, us, u, l, big, c + us, (int)(u > l));
    return 0;
}`,
  },
  {
    name: 'integer arithmetic bitwise shifts and precedence',
    output: 'exact',
    source: String.raw`#include <stdio.h>
int main(void) {
    int a = 0x5a, b = 013;
    unsigned int x = 0xf0U;
    printf("%d %d %d %d %u %u %u\n", a + b * 2, (a + b) * 2, a & b, a | b, x >> 3, x << 2, x ^ 0xffU);
    printf("%d %d %d %d\n", -17 / 5, -17 % 5, 17 / -5, 17 % -5);
    return 0;
}`,
  },
  {
    name: 'float32 double conversions and numeric formatting',
    output: 'numbers',
    source: String.raw`#include <stdio.h>
float addf(float a, float b) { return a + b; }
double addd(double a, double b) { return a + b; }
int main(void) {
    float f = 0.1f + 0.2f;
    double d = 0.1 + 0.2;
    printf("%.17g %.17g %.9g %.9g\n", f, d, addf(0.1f, 0.2f), addd(0.1, 0.2));
    printf("%.9g %.9g %.9g\n", (double)(float)16777217.0, (double)(float)0.1, (double)f);
    return 0;
}`,
  },
  {
    name: 'math library numeric results',
    output: 'numbers',
    source: String.raw`#include <stdio.h>
#include <math.h>
int main(void) {
    printf("%.8f %.8f %.8f %.8f %.8f\n", sqrt(2.0), pow(2.0, 10.0), fabs(-3.5), floor(3.8), ceil(3.2));
    printf("%.8f %.8f %.8f %.8f %.8f\n", sin(0.5), cos(0.5), tan(0.5), log(2.0), exp(1.0));
    return 0;
}`,
  },
  {
    name: 'casts sizeof and conditional common type',
    output: 'numbers',
    source: String.raw`#include <stdio.h>
struct Pair { char c; int value; };
int main(void) {
    int i = -7;
    printf("%d %d %d %d %d\n", (int)sizeof(char), (int)sizeof(int), (int)sizeof(double), (int)sizeof(struct Pair), (int)sizeof(i++));
    printf("%.1f %.1f %d %d\n", 1 ? 2 : 3.5, 0 ? 2 : 3.5, (int)(double)i, (int)(i == -7));
    return 0;
}`,
  },
  {
    name: 'short circuit comma and ordered side effects',
    output: 'exact',
    source: String.raw`#include <stdio.h>
int main(void) {
    int i = 0;
    int a = i++ && i++;
    int b = i++ || i++;
    int c = (i++, i + 10);
    int d = i ? i : (i++, 99);
    printf("%d %d %d %d %d\n", a, b, c, d, i);
    return 0;
}`,
  },
  {
    name: 'loops switch and control flow',
    output: 'exact',
    source: String.raw`#include <stdio.h>
int main(void) {
    int sum = 0;
    for (int i = 0; i < 10; ++i) {
        if (i == 2) continue;
        if (i == 8) break;
        sum += i;
    }
    int n = 3;
    do { sum += n; --n; } while (n > 0);
    switch (sum) { case 34: sum += 1; break; default: sum = -1; }
    printf("%d %d\n", sum, n);
    return 0;
}`,
  },
  {
    name: 'recursion and function pointer calls',
    output: 'exact',
    source: String.raw`#include <stdio.h>
int fact(int n) { return n < 2 ? 1 : n * fact(n - 1); }
int apply(int (*fn)(int), int value) { return fn(value); }
int twice(int x) { return x * 2; }
int main(void) {
    int (*fn)(int) = twice;
    printf("%d %d %d\n", fact(6), apply(fn, 21), (*fn)(4));
    return 0;
}`,
  },
  {
    name: 'arrays pointer arithmetic and multidimensional indexing',
    output: 'exact',
    source: String.raw`#include <stdio.h>
int sum(int a[], int n) { int total = 0; for (int i = 0; i < n; ++i) total += a[i]; return total; }
int main(void) {
    int a[4] = {4, 8, 15, 16};
    int matrix[2][2] = {{1, 2}, {3, 4}};
    int *p = a + 1;
    printf("%d %d %ld %d %d\n", sum(a, 4), *p, (long)((a + 4) - p), matrix[1][0], *(matrix[0] + 1));
    return 0;
}`,
  },
  {
    name: 'struct union enum typedef and layout',
    output: 'exact',
    source: String.raw`#include <stdio.h>
typedef enum { RED = 2, GREEN, BLUE = 8 } Color;
typedef struct { char tag; int value; } Item;
union Bits { int number; unsigned char bytes[4]; };
int main(void) {
    Item item = {'A', 42};
    union Bits bits;
    bits.number = 0x12345678;
    Color color = GREEN;
    printf("%c %d %d %d %d %d\n", item.tag, item.value, color, bits.number != 0, (int)sizeof(Item), (int)sizeof(bits));
    return 0;
}`,
  },
  {
    name: 'strings and byte-oriented library calls',
    output: 'exact',
    source: String.raw`#include <stdio.h>
#include <string.h>
int main(void) {
    char text[32] = "hello";
    char copy[32];
    strcpy(copy, text);
    strcat(text, " world");
    printf("%s %s %d %d %d %d\n", text, copy, (int)strlen(text), strcmp(text, copy) > 0, strchr(text, 'w') != 0, strstr(text, "world") != 0);
    return 0;
}`,
  },
  {
    name: 'heap calloc byte memory and qsort',
    output: 'exact',
    source: String.raw`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int compare(const void *left, const void *right) { return *(const int *)left - *(const int *)right; }
int main(void) {
    int *a = malloc(4 * sizeof(int));
    int *zero = calloc(2, sizeof(int));
    int source[4] = {9, 1, 7, 3};
    int first;
    int last;
    int same;
    memcpy(a, source, sizeof(source));
    qsort(a, 4, sizeof(int), compare);
    first = a[0];
    last = a[3];
    same = memcmp(a, source, sizeof(int)) == 0;
    memset(a, 0, sizeof(int));
    printf("%d %d %d %d %d %d\n", first, last, zero[0], zero[1], same, a[0] == 0);
    free(a);
    free(zero);
    return 0;
}`,
  },
  {
    name: 'formatted buffers and numeric conversion library',
    output: 'exact',
    source: String.raw`#include <stdio.h>
#include <stdlib.h>
int main(void) {
    char buffer[64];
    sprintf(buffer, "%d %.1f %s", atoi("42"), atof("3.5"), "ok");
    printf("%s %d\n", buffer, (int)snprintf(buffer, sizeof(buffer), "%x", 255));
    return 0;
}`,
  },
  {
    name: 'scanf and sscanf input conversion',
    output: 'exact',
    input: '12 3.5 hello\n',
    source: String.raw`#include <stdio.h>
int main(void) {
    int i; double d; char word[16];
    int first = scanf("%d %lf %15s", &i, &d, word);
    int parsed; sscanf("99", "%d", &parsed);
    printf("%d %d %.1f %s %d\n", first, i, d, word, parsed);
    return 0;
}`,
  },
  {
    name: 'global static and local static lifetime',
    output: 'exact',
    source: String.raw`#include <stdio.h>
int global = 4;
static int hidden = 8;
int next(void) { static int count = 0; return ++count; }
int main(void) {
    int first = next();
    int second = next();
    int third = next();
    printf("%d %d %d %d %d\n", global, hidden, first, second, third);
    return 0;
}`,
  },
  {
    name: 'preprocessor conditions and macros',
    output: 'exact',
    source: String.raw`#include <stdio.h>
#define ADD(a,b) ((a) + (b))
#define CAT(a,b) a##b
#define TEXT(x) #x
#if 2 + 2 == 4
#define MODE 7
#else
#define MODE 0
#endif
int main(void) {
    int CAT(my,Value) = ADD(3, 4);
    printf("%d %d %s\n", myValue, MODE, TEXT(a + b));
    return 0;
}`,
  },
  {
    name: 'multi-file declarations and linkage',
    output: 'exact',
    files: {
      'main.c': String.raw`#include <stdio.h>
int add(int, int);
extern int shared;
int main(void) { printf("%d %d\n", add(shared, 5), shared); return 0; }
`,
      'helper.c': String.raw`int shared = 7;
int add(int a, int b) { return a + b; }
`,
    },
    source: String.raw`#include <stdio.h>
int add(int, int);
extern int shared;
int main(void) { printf("%d %d\n", add(shared, 5), shared); return 0; }
`,
  },
  {
    name: 'numeric boundaries within safe integer range',
    output: 'numbers',
    source: String.raw`#include <stdio.h>
int main(void) {
    unsigned long long a = 9007199254740000ULL;
    unsigned long long b = 12345ULL;
    printf("%llu %llu %llu %llu\n", a, b, a + b, a - b);
    printf("%.9g %.9g %.9g\n", 1.0 / 3.0, 1.0e-20, 1.0e20);
    return 0;
}`,
  },
  {
    name: 'compound assignments and increment operators',
    output: 'exact',
    source: String.raw`#include <stdio.h>
int main(void) {
    int value = 5;
    int old = value++;
    int prefix = ++value;
    value *= 3;
    value -= 4;
    value %= 5;
    value <<= 2;
    value |= 3;
    int last = value--;
    printf("%d %d %d %d\n", old, prefix, last, value);
    return 0;
}`,
  },
  {
    name: 'same-array pointer comparisons and null pointer constants',
    output: 'exact',
    source: String.raw`#include <stdio.h>
#include <string.h>
int main(void) {
    int values[3] = {10, 20, 30};
    int *first = values;
    int *last = values + 2;
    printf("%d %d %d %ld %d\n", first < last, last > first, first != 0, (long)(last - first), (int)(first == 0));
    return 0;
}`,
  },
  {
    name: 'designated and nested aggregate initializers',
    output: 'exact',
    source: String.raw`#include <stdio.h>
struct Pair { int x; int y; };
int main(void) {
    int values[4] = {[2] = 7, [0] = 1};
    struct Pair point = {.y = 9, .x = 4};
    int matrix[2][2] = {[1] = {[0] = 8, [1] = 6}};
    printf("%d %d %d %d %d %d\n", values[0], values[1], values[2], point.x, point.y, matrix[1][1]);
    return 0;
}`,
  },
  {
    name: 'void pointers and explicit pointee casts',
    output: 'exact',
    source: String.raw`#include <stdio.h>
int main(void) {
    int value = 42;
    void *raw = &value;
    int *typed = (int *)raw;
    printf("%d %d %d\n", *typed, raw != 0, *(int *)raw == value);
    return 0;
}`,
  },
  {
    name: 'overlap-safe memory movement and bounded strings',
    output: 'exact',
    source: String.raw`#include <stdio.h>
#include <string.h>
int main(void) {
    char text[16] = "abcdef";
    char copy[16] = {0};
    strncpy(copy, text + 1, 3);
    copy[3] = 0;
    memmove(text + 2, text, 4);
    printf("%s %s %d %d\n", text, copy, (int)strncmp(text, "ab", 2), (int)memcmp(copy, "bcd", 3));
    return 0;
}`,
  },
  {
    name: 'line input and character output',
    output: 'exact',
    input: 'hello world\n',
    source: String.raw`#include <stdio.h>
#include <string.h>
int main(void) {
    char text[16];
    char *result = fgets(text, sizeof(text), stdin);
    if (result) { putchar(text[0]); putchar(text[5]); printf(" %d\n", (int)strlen(text)); }
    return 0;
}`,
  },
  {
    name: 'structure return and aggregate assignment',
    output: 'exact',
    source: String.raw`#include <stdio.h>
struct Point { int x; int y; };
struct Point make(int x, int y) { struct Point point = {x, y}; return point; }
int main(void) {
    struct Point a = make(3, 4);
    struct Point b = a;
    b.x += 10;
    printf("%d %d %d %d\n", a.x, a.y, b.x, b.y);
    return 0;
}`,
  },
];

const numericToken = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

function compareNumericOutput(expected: string, actual: string, name: string): void {
  const expectedTokens = expected.trim().split(/\s+/).filter(Boolean);
  const actualTokens = actual.trim().split(/\s+/).filter(Boolean);
  expect(actualTokens.length, `${name}: numeric token count`).toBe(expectedTokens.length);
  expectedTokens.forEach((token, index) => {
    const received = actualTokens[index];
    if (!numericToken.test(token) || !numericToken.test(received)) {
      expect(received, `${name}: token ${index + 1}`).toBe(token);
      return;
    }
    const expectedValue = Number(token);
    const actualValue = Number(received);
    if (Number.isInteger(expectedValue) && Number.isInteger(actualValue)) {
      expect(actualValue, `${name}: integer token ${index + 1}`).toBe(expectedValue);
      return;
    }
    const tolerance = 1e-7 * Math.max(1, Math.abs(expectedValue));
    expect(Math.abs(actualValue - expectedValue), `${name}: numeric token ${index + 1}`).toBeLessThanOrEqual(tolerance);
  });
}

async function compareWithGcc(testCase: BatchCase): Promise<void> {
  const files = testCase.files ?? { 'main.c': testCase.source };
  const directory = mkdtempSync(join(tmpdir(), 'c-lab-batch-'));
  try {
    for (const [file, source] of Object.entries(files)) writeFileSync(join(directory, file), source);
    const cFiles = Object.keys(files).filter(file => file.endsWith('.c'));
    const compile = spawnSync('gcc', ['-std=c17', '-O0', '-Wall', '-Wextra', ...cFiles, '-lm', '-o', 'program'], {
      cwd: directory,
      encoding: 'utf8',
    });
    expect(compile.status, `${testCase.name}: GCC compilation failed\n${compile.stderr}`).toBe(0);

    const native = spawnSync(join(directory, 'program'), [], {
      cwd: directory,
      input: testCase.input ?? '',
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(native.error, `${testCase.name}: GCC execution failed`).toBeUndefined();
    expect(native.status, `${testCase.name}: GCC exit code`).toBe(0);

    const trace = await runTraceAsync(testCase.source, testCase.input ?? '', Object.keys(files).length > 1 ? files : undefined);
    expect(trace.status, `${testCase.name}: interpreter status\n${trace.error ?? ''}`).toBe('completed');
    expect(trace.error, `${testCase.name}: interpreter error`).toBeUndefined();
    expect(trace.exitCode, `${testCase.name}: interpreter exit code`).toBe(native.status);
    if (testCase.output === 'exact') expect(trace.output, `${testCase.name}: output`).toBe(native.stdout);
    else compareNumericOutput(native.stdout, trace.output, testCase.name);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it.each(cases)('batch GCC comparison: $name', async testCase => {
  await compareWithGcc(testCase);
});
