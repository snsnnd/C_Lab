import { useCallback, useEffect, useRef, useState } from 'react';
import type { Trace } from '../engine/types';

export function useRunner() {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const worker = useRef<Worker | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);

  const cleanup = useCallback(() => {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
  }, []);

  const cancel = useCallback(() => {
    cleanup();
    setRunning(false);
    setMessage('已停止本次执行。');
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setRunning(false);
    setTrace(null);
    setMessage('');
  }, [cleanup]);

  const run = useCallback((source: string, input: string, onReady?: (trace: Trace) => void, files?: Record<string, string>) => {
    cleanup();
    setRunning(true);
    setMessage('');
    const ticket = generation.current;
    try {
      const instance = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<Trace>) => {
        if (ticket !== generation.current) return;
        setTrace(event.data);
        setRunning(false);
        onReady?.(event.data);
        cleanup();
      };
      instance.onerror = () => {
        if (ticket !== generation.current) return;
        cleanup();
        setRunning(false);
        setMessage('执行器未能启动。请刷新页面重试，或查看终端是否完成依赖安装。');
      };
      timeout.current = setTimeout(() => {
        if (ticket !== generation.current) return;
        cleanup();
        setRunning(false);
        setMessage('执行超过 8 秒，已终止工作线程。请检查是否存在无限循环或过大的数组。');
      }, 8000);
      instance.postMessage({ source, input, files });
    } catch (error) {
      cleanup();
      setRunning(false);
      setMessage(`无法创建执行线程：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);
  return { trace, running, message, run, cancel, reset };
}
