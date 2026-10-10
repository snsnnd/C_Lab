// Classroom sync protocol shared by the host and viewers. The wire format is
// validated on both sides so a malformed message never reaches React state.

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_LENGTH = 6;
export const ROOM_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const MAX_WORKSPACE_FILES = 24;
export const MAX_MESSAGE_CHARS = 200_000;

export interface WorkspaceMessage {
  type: 'workspace';
  lessonId: string;
  /** Complete file map including main.c. */
  files: Record<string, string>;
  input: string;
}

export interface StepMessage {
  type: 'step';
  step: number;
  playing: boolean;
}

export interface PresenceMessage {
  type: 'presence';
  viewers: number;
}

export type HostMessage = WorkspaceMessage | StepMessage;
export type ServerMessage = HostMessage | PresenceMessage;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DRAFT_BACKUP_KEY = 'c-lab-classroom-backup-v1';

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

/**
 * Keep the visitor's own drafts before a classroom replaces them. The first
 * backup wins: reloading the page mid-class must not overwrite the restore point
 * with the teacher's state.
 */
export function keepDraftBackup<T>(room: string, drafts: T, storage: StorageLike | null = browserStorage()): void {
  if (!storage || loadDraftBackup(storage)) return;
  try { storage.setItem(DRAFT_BACKUP_KEY, JSON.stringify({ room, drafts })); }
  catch { /* storage full or blocked */ }
}

export function loadDraftBackup<T = unknown>(storage: StorageLike | null = browserStorage()): { room: string; drafts: T } | null {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(DRAFT_BACKUP_KEY) ?? 'null');
    if (value && typeof value === 'object' && typeof value.room === 'string' && value.drafts && typeof value.drafts === 'object') {
      return value as { room: string; drafts: T };
    }
  } catch { /* corrupted entry */ }
  return null;
}

export function clearDraftBackup(storage: StorageLike | null = browserStorage()): void {
  try { storage?.removeItem(DRAFT_BACKUP_KEY); }
  catch { /* ignore */ }
}

export function makeRoom(): string {
  const bytes = new Uint8Array(ROOM_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('');
}

export function makeHostKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Tolerates pasted text: uppercase, drop separators, keep the first six slots. */
export function normalizeRoom(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_LENGTH);
}

export function joinUrl(href: string, room: string): string {
  const url = new URL(href);
  url.searchParams.set('join', room);
  url.hash = '';
  return url.toString();
}

/** Same link, but at a specific LAN host/port (the teacher may be on localhost). */
export function joinUrlOn(href: string, room: string, host: string, port?: number | string): string {
  const url = new URL(href);
  url.hostname = host;
  if (port) url.port = String(port);
  url.searchParams.set('join', room);
  url.hash = '';
  return url.toString();
}

export interface ClassroomInfo {
  port?: number;
  addresses?: string[];
  publicOrigin?: string;
}

/** Prefer an explicitly configured public origin over container/LAN interfaces. */
export function classroomShareLinks(href: string, room: string, info?: ClassroomInfo | null): string[] {
  if (!room) return [];
  if (info?.publicOrigin) return [joinUrl(info.publicOrigin, room)];
  const own = joinUrl(href, room);
  const onLocalhost = ['localhost', '127.0.0.1', '[::1]', '::1', ''].includes(new URL(href).hostname);
  const addresses = Array.isArray(info?.addresses) ? info.addresses : [];
  const lan = addresses.map(address => joinUrlOn(href, room, address, info?.port));
  const ordered = onLocalhost ? lan : [own, ...lan];
  return [...new Set(ordered.length ? ordered : [own])];
}

function isFileMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > MAX_WORKSPACE_FILES) return false;
  let total = 0;
  for (const [name, source] of entries) {
    if (!/^[\w-]+\.(c|h)$/.test(name) || typeof source !== 'string') return false;
    total += source.length;
  }
  return total <= MAX_MESSAGE_CHARS;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  if (raw.length > MAX_MESSAGE_CHARS) return null;
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type === 'presence') {
    return Number.isInteger(message.viewers) && (message.viewers as number) >= 0
      ? { type: 'presence', viewers: message.viewers as number }
      : null;
  }
  if (message.type === 'workspace') {
    return typeof message.lessonId === 'string' && isFileMap(message.files) && typeof message.input === 'string'
      ? { type: 'workspace', lessonId: message.lessonId, files: message.files, input: message.input }
      : null;
  }
  if (message.type === 'step') {
    return Number.isInteger(message.step) && (message.step as number) >= 0 && (message.step as number) <= 1_000_000 && typeof message.playing === 'boolean'
      ? { type: 'step', step: message.step as number, playing: message.playing }
      : null;
  }
  return null;
}
