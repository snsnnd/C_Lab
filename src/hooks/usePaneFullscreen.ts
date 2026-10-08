import { useEffect, useRef, useState } from 'react';

export function usePaneFullscreen(onError: (message: string) => void) {
  const editor = useRef<HTMLElement>(null);
  const visual = useRef<HTMLElement>(null);
  const [active, setActive] = useState<'none' | 'editor' | 'visual'>('none');
  useEffect(() => {
    const changed = () => setActive(document.fullscreenElement === editor.current ? 'editor' : document.fullscreenElement === visual.current ? 'visual' : 'none');
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  const toggle = async (pane: 'editor' | 'visual') => {
    const element = (pane === 'editor' ? editor : visual).current;
    if (!element?.requestFullscreen || !document.fullscreenEnabled) {
      onError('此浏览器或嵌入页面未开放元素全屏，请使用支持 Fullscreen API 的浏览器直接打开页面。');
      return;
    }
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch { onError('浏览器未允许全屏，请从页面按钮重新进入；嵌入页面需要允许全屏。'); }
  };
  return { editor, visual, active, toggle };
}
