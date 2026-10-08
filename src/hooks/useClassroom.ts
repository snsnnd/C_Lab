import { useCallback, useEffect, useRef, useState } from 'react';
import {
  makeHostKey, makeRoom, parseServerMessage, type HostMessage, type StepMessage, type WorkspaceMessage,
} from '../lib/classroom';

export type ClassroomRole = 'off' | 'host' | 'viewer';
export type ClassroomStatus = 'idle' | 'connecting' | 'live' | 'error';

/**
 * Connects the page to the classroom sync server. The host publishes state and
 * watches the viewer count; viewers receive the host's workspace and steps.
 * The server is expected on the same origin, so the offline build stays simple.
 */
export function useClassroom(handlers: { onWorkspace?: (message: WorkspaceMessage) => void; onStep?: (message: StepMessage) => void }) {
  const [role, setRole] = useState<ClassroomRole>('off');
  const [room, setRoom] = useState('');
  const [viewers, setViewers] = useState(0);
  const [status, setStatus] = useState<ClassroomStatus>('idle');
  const [error, setError] = useState('');
  const events = useRef<EventSource | null>(null);
  const hostKey = useRef('');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const disconnect = useCallback(() => {
    events.current?.close();
    events.current = null;
    hostKey.current = '';
    setRole('off');
    setRoom('');
    setViewers(0);
    setStatus('idle');
    setError('');
  }, []);

  useEffect(() => disconnect, [disconnect]);

  const connect = useCallback((code: string, asHost: boolean) => {
    events.current?.close();
    const query = new URLSearchParams({ room: code, role: asHost ? 'host' : 'viewer' });
    if (asHost) query.set('key', hostKey.current);
    const source = new EventSource(`/api/events?${query}`);
    events.current = source;
    setStatus('connecting');
    source.onopen = () => { setStatus('live'); setError(''); };
    source.onerror = () => {
      // EventSource reconnects on its own; report it without tearing down state.
      setStatus(current => current === 'live' ? 'error' : 'connecting');
    };
    source.onmessage = event => {
      const message = parseServerMessage(event.data);
      if (!message) return;
      if (message.type === 'presence') { setViewers(message.viewers); return; }
      if (asHost) return;
      if (message.type === 'workspace') handlersRef.current.onWorkspace?.(message);
      if (message.type === 'step') handlersRef.current.onStep?.(message);
    };
  }, []);

  const startHost = useCallback(() => {
    const code = makeRoom();
    hostKey.current = makeHostKey();
    setRole('host');
    setRoom(code);
    connect(code, true);
    return code;
  }, [connect]);

  const joinRoom = useCallback((code: string) => {
    hostKey.current = '';
    setRole('viewer');
    setRoom(code);
    connect(code, false);
  }, [connect]);

  const publish = useCallback(async (message: HostMessage) => {
    if (!hostKey.current) return false;
    try {
      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ room: room, key: hostKey.current, message }),
      });
      if (!response.ok) {
        setStatus('error');
        setError('共享已中断，请重新开始共享。');
        return false;
      }
      setStatus('live');
      setError('');
      return true;
    } catch {
      setStatus('error');
      setError('无法连接共享服务，请确认课堂服务仍在运行。');
      return false;
    }
  }, [room]);

  const leave = useCallback((notify?: (text: string) => void) => {
    const wasActive = role !== 'off';
    disconnect();
    if (wasActive) notify?.(role === 'host' ? '已停止课堂共享。' : '已退出跟随，可以自由编辑了。');
  }, [disconnect, role]);

  return { role, room, viewers, status, error, startHost, joinRoom, publish, leave };
}
