import { describe, expect, it } from 'vitest';
import { isTypingTarget, matchShortcut, type KeyInfo } from '../lib/shortcuts';

const press = (key: string, extra: Partial<KeyInfo> = {}): KeyInfo => ({ key, ctrl: false, meta: false, shift: false, alt: false, typing: false, ...extra });

describe('shortcut matching', () => {
  it('runs with the platform-appropriate modifier', () => {
    expect(matchShortcut(press('Enter', { ctrl: true }))).toBe('run');
    expect(matchShortcut(press('Enter', { meta: true }))).toBe('run');
    expect(matchShortcut(press('Enter'))).toBeNull();
  });

  it('stops with the modifier period', () => {
    expect(matchShortcut(press('.', { meta: true }))).toBe('stop');
    expect(matchShortcut(press('.'))).toBeNull();
  });

  it('steps forward and back outside the editor', () => {
    expect(matchShortcut(press('ArrowRight'))).toBe('next');
    expect(matchShortcut(press('ArrowLeft'))).toBe('prev');
    expect(matchShortcut(press(' ', { shift: true }))).toBe('prev');
    expect(matchShortcut(press('Home'))).toBe('first');
    expect(matchShortcut(press('End'))).toBe('last');
  });

  it('keeps text keys while the code editor has focus', () => {
    expect(matchShortcut(press(' '))).toBe('toggle-play');
    expect(matchShortcut(press(' ', { typing: true }))).toBeNull();
    expect(matchShortcut(press('ArrowRight', { typing: true }))).toBeNull();
    expect(matchShortcut(press('Home', { typing: true }))).toBeNull();
    expect(matchShortcut(press('?', { typing: true }))).toBeNull();
  });

  it('still steps while typing via alt arrows, and runs via the modifier', () => {
    expect(matchShortcut(press('ArrowRight', { typing: true, alt: true }))).toBe('next');
    expect(matchShortcut(press('ArrowLeft', { typing: true, alt: true }))).toBe('prev');
    expect(matchShortcut(press('Enter', { typing: true, meta: true }))).toBe('run');
  });

  it('always allows closing overlays and the help panel', () => {
    expect(matchShortcut(press('Escape', { typing: true }))).toBe('escape');
    expect(matchShortcut(press('?'))).toBe('help');
  });

  it('leaves unrelated keys alone', () => {
    for (const key of ['a', 'Tab', 'PageDown', 'F5', 'Backspace']) expect(matchShortcut(press(key))).toBeNull();
  });

  it('detects editable targets', () => {
    const target = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;
    expect(isTypingTarget(target('DIV', true))).toBe(true);
    expect(isTypingTarget(target('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(target('INPUT'))).toBe(true);
    expect(isTypingTarget(target('SELECT'))).toBe(true);
    expect(isTypingTarget(target('BUTTON'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
