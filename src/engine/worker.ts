import { runTraceAsync } from './trace';

self.onmessage = async (event: MessageEvent<{ source: string; input: string; files?: Record<string, string> }>) => {
  const { source, input, files } = event.data;
  try {
    self.postMessage(await runTraceAsync(source, input, files));
  } catch (error) {
    self.postMessage({
      source,
      files,
      input,
      snapshots: [],
      output: '',
      status: 'error',
      error: `执行器内部错误：${error instanceof Error ? error.message : String(error)}`,
      duration: 0,
      platform: { bits: 64, pointerSize: 8, endian: 'little', label: 'x86-64 教学模型（8 字节指针、小端）' },
    });
  }
};
