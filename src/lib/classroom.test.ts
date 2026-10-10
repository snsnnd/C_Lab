import { describe, expect, it } from 'vitest';
import { classroomShareLinks, clearDraftBackup, joinUrl, joinUrlOn, keepDraftBackup, loadDraftBackup, makeHostKey, makeRoom, normalizeRoom, parseServerMessage, ROOM_PATTERN, type StorageLike } from './classroom';

describe('classroom protocol', () => {
  it('generates six-slot rooms without confusing characters and 32-char keys', () => {
    for (let i = 0; i < 50; i++) {
      const room = makeRoom();
      expect(room).toMatch(ROOM_PATTERN);
      expect(room).not.toMatch(/[01IO]/);
    }
    expect(makeHostKey()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('normalizes pasted room codes', () => {
    expect(normalizeRoom(' ab-12 cd ')).toBe('AB12CD');
    expect(normalizeRoom('abcdefgh')).toBe('ABCDEF');
    expect(ROOM_PATTERN.test('ABCDEF')).toBe(true);
    expect(ROOM_PATTERN.test('ABC0EF')).toBe(false);
    expect(ROOM_PATTERN.test('abcdef')).toBe(false);
    expect(ROOM_PATTERN.test('ABCDE')).toBe(false);
  });

  it('builds a join link from any current URL', () => {
    expect(joinUrl('http://10.0.0.5:8000/lab/?join=OLD#x', 'NEW234')).toBe('http://10.0.0.5:8000/lab/?join=NEW234');
    expect(joinUrl('http://localhost:5173/', 'ABCDEF')).toBe('http://localhost:5173/?join=ABCDEF');
  });

  it('rebuilds the link at a LAN address for student devices', () => {
    expect(joinUrlOn('http://localhost:8000/?x=1#y', 'ABCDEF', '192.168.1.3', 8000)).toBe('http://192.168.1.3:8000/?x=1&join=ABCDEF');
    expect(joinUrlOn('http://localhost:8000/', 'ABCDEF', '10.0.0.7')).toBe('http://10.0.0.7:8000/?join=ABCDEF');
  });

  it('prefers the public origin, including external scheme and port', () => {
    expect(classroomShareLinks('http://localhost:8000/?join=OLD#x', 'ABCDEF', {
      publicOrigin: 'https://clab.example.com:8443', port: 8000, addresses: ['172.17.0.2'],
    })).toEqual(['https://clab.example.com:8443/?join=ABCDEF']);
    expect(classroomShareLinks('http://localhost:8000/', '', { publicOrigin: 'https://clab.example.com' })).toEqual([]);
  });

  it('preserves native LAN links and uses the browser URL when discovery is disabled', () => {
    expect(classroomShareLinks('http://localhost:8000/', 'ABCDEF', { port: 8000, addresses: ['192.168.1.3'] }))
      .toEqual(['http://192.168.1.3:8000/?join=ABCDEF']);
    expect(classroomShareLinks('http://[::1]:8000/', 'ABCDEF', { port: 8000, addresses: ['192.168.1.3'] }))
      .toEqual(['http://192.168.1.3:8000/?join=ABCDEF']);
    expect(classroomShareLinks('http://192.168.1.3:9000/', 'ABCDEF', { port: 8000, addresses: [] }))
      .toEqual(['http://192.168.1.3:9000/?join=ABCDEF']);
    expect(classroomShareLinks('https://clab.example.com/', 'ABCDEF', null))
      .toEqual(['https://clab.example.com/?join=ABCDEF']);
  });

  it('keeps the first draft backup until it is cleared', () => {
    const map = new Map<string, string>();
    const storage: StorageLike = {
      getItem: key => map.get(key) ?? null,
      setItem: (key, value) => { map.set(key, value); },
      removeItem: key => { map.delete(key); },
    };
    expect(loadDraftBackup(storage)).toBeNull();
    keepDraftBackup('ABCDEF', { arrays: { code: 'mine', input: '' } }, storage);
    // A reload mid-class must not overwrite the original restore point.
    keepDraftBackup('ABCDEF', { arrays: { code: 'teacher', input: '' } }, storage);
    expect(loadDraftBackup<{ arrays: { code: string } }>(storage)).toEqual({ room: 'ABCDEF', drafts: { arrays: { code: 'mine', input: '' } } });
    clearDraftBackup(storage);
    expect(loadDraftBackup(storage)).toBeNull();
  });

  it('ignores corrupted backup entries', () => {
    const map = new Map<string, string>([['c-lab-classroom-backup-v1', 'not json']]);
    const storage: StorageLike = { getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: key => { map.delete(key); } };
    expect(loadDraftBackup(storage)).toBeNull();
  });

  it('accepts valid workspace, step and presence messages', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'workspace', lessonId: 'macros', files: { 'main.c': 'int main(){}' }, input: '' })))
      .toEqual({ type: 'workspace', lessonId: 'macros', files: { 'main.c': 'int main(){}' }, input: '' });
    expect(parseServerMessage(JSON.stringify({ type: 'step', step: 42, playing: true }))).toEqual({ type: 'step', step: 42, playing: true });
    expect(parseServerMessage(JSON.stringify({ type: 'presence', viewers: 7 }))).toEqual({ type: 'presence', viewers: 7 });
  });

  it('rejects malformed or oversized messages', () => {
    for (const raw of [
      'not json', '[]', '{}', '{"type":"other"}',
      '{"type":"workspace","lessonId":"a","files":{},"input":""}',
      '{"type":"workspace","lessonId":"a","files":{"..\\/evil.c":"x"},"input":""}',
      '{"type":"workspace","lessonId":"a","files":{"main.c":1},"input":""}',
      '{"type":"step","step":-1,"playing":false}',
      '{"type":"step","step":1.5,"playing":false}',
      '{"type":"step","step":1,"playing":"yes"}',
      '{"type":"presence","viewers":-2}',
    ]) expect(parseServerMessage(raw)).toBeNull();
    const huge = JSON.stringify({ type: 'workspace', lessonId: 'a', files: { 'main.c': 'x'.repeat(200_001) }, input: '' });
    expect(parseServerMessage(huge)).toBeNull();
  });
});
