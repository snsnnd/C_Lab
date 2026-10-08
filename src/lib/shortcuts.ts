export type ShortcutAction = 'run' | 'stop' | 'toggle-play' | 'next' | 'prev' | 'first' | 'last' | 'help' | 'escape';

export interface KeyInfo {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  /** The event came from an editable field: the code editor, a textarea or an input. */
  typing: boolean;
}

export interface Shortcut {
  action: ShortcutAction;
  keys: string;
  label: string;
  /** Shown as a caveat when the shortcut cannot fire while typing. */
  note?: string;
}

const isNext = (key: string) => key === 'ArrowRight' || key === 'Right';
const isPrev = (key: string) => key === 'ArrowLeft' || key === 'Left';

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return false;
}

/**
 * Playback keys are only free when nobody is typing: inside the code editor a space has to
 * stay a space. Alt + arrows keep working there so stepping never requires leaving the editor.
 */
export function matchShortcut(keys: KeyInfo): ShortcutAction | null {
  const { key, ctrl, meta, shift, alt, typing } = keys;
  const mod = ctrl || meta;
  if (mod && (key === 'Enter' || key === 'Return')) return 'run';
  if (mod && (key === '.' || key === '。')) return 'stop';
  if (key === 'Escape') return 'escape';
  if (mod) return null;
  if (alt && isNext(key)) return 'next';
  if (alt && isPrev(key)) return 'prev';
  if (alt) return null;
  if (typing) return null;
  if (key === '?') return 'help';
  if (shift && key === ' ') return 'prev';
  if (key === ' ') return 'toggle-play';
  if (isNext(key)) return 'next';
  if (isPrev(key)) return 'prev';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  return null;
}

export const SHORTCUTS: Shortcut[] = [
  { action: 'run', keys: 'Ctrl / ⌘ + Enter', label: '运行代码' },
  { action: 'stop', keys: 'Ctrl / ⌘ + .', label: '停止执行' },
  { action: 'toggle-play', keys: 'Space', label: '播放 / 暂停', note: '在编辑器里会输入空格，此键不生效' },
  { action: 'next', keys: '→', label: '下一步', note: '编辑器内用 Alt + →' },
  { action: 'prev', keys: '←', label: '上一步', note: '编辑器内用 Alt + ←' },
  { action: 'prev', keys: 'Shift + Space', label: '上一步', note: '输入时保留文本编辑行为' },
  { action: 'first', keys: 'Home', label: '回到第一步', note: '编辑器内不生效' },
  { action: 'last', keys: 'End', label: '跳到最后一步', note: '编辑器内不生效' },
  { action: 'help', keys: '?', label: '打开 / 关闭本面板', note: '编辑器内不生效' },
  { action: 'escape', keys: 'Esc', label: '关闭弹层', note: '任何位置都可用' },
];
