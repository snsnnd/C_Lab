import { expect, it } from 'vitest';
import { runTraceAsync } from './trace';

const bubbleSortSource = `#include <stdio.h>
// 函数声明
void bubble_sort(int arr[], int len);
int main() {
    int arr[] = { 22, 34, 3, 32, 82, 55, 89, 50, 37, 5, 64, 35, 9, 70 };
    int len = sizeof(arr) / sizeof(arr[0]);
    bubble_sort(arr, len);
    for (int i = 0; i < len; i++) {
        printf("%d ", arr[i]);
    }
    return 0;
}
void bubble_sort(int arr[], int len) {
    for (int i = 0; i < len - 1; i++) {
        for (int j = 0; j < len - 1 - i; j++) {
            if (arr[j] > arr[j + 1]) {
                int temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
            }
        }
    }
}`;

it('sorts the user’s 14-element array through an unsized array parameter', async () => {
  const trace = await runTraceAsync(bubbleSortSource);
  expect(trace.error).toBeUndefined();
  expect(trace.status).toBe('completed');
  expect(trace.output).toBe('3 5 9 22 32 34 35 37 50 55 64 70 82 89 ');
  expect(trace.snapshots.some(s => s.variables.some(v => v.name === 'arr' && v.kind === 'pointer'))).toBe(true);
});

it('adjusts sized parameters too: sizeof is the pointer size and writes affect the caller', async () => {
  const trace = await runTraceAsync('#include <stdio.h>\nint f(int a[10]){a[0]=42;return sizeof(a);}\nint main(void){int a[2]={1,2}; printf("%d ",f(a)); printf("%d %d",a[0],(int)sizeof(a));return 0;}');
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('8 42 8');
});

it('links array prototypes and pointer definitions as compatible declarations', async () => {
  const files = { 'main.c': 'void f(int a[]); int main(void){int a[1]={0};f(a);return a[0];}', 'f.c': 'void f(int *a){a[0]=7;}' };
  const trace = await runTraceAsync(files['main.c'], '', files);
  expect(trace.error).toBeUndefined();
  expect(trace.exitCode).toBe(7);
});

it('adjusts only the outer dimension of a matrix parameter', async () => {
  const trace = await runTraceAsync('#include <stdio.h>\nint sum(int a[][3],int n){int s=0;for(int i=0;i<n;i++)for(int j=0;j<3;j++)s+=a[i][j];a[1][2]=42;return s;}\nint main(void){int a[2][3]={{1,2,3},{4,5,6}};printf("%d ",sum(a,2));printf("%d %d",a[1][2],(int)sizeof(a));return 0;}');
  expect(trace.error).toBeUndefined();
  expect(trace.output).toBe('21 42 24');
});
