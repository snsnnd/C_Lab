import { useRef, useState } from 'react';
import { CodeEditor } from './CodeEditor';

const MIN_WIDTH = 300;
const MIN_HEIGHT = 200;
const HEADER_HEIGHT = 34;

/**
 * A draggable / resizable code window shown over the fullscreen visualization,
 * so the teacher can talk through the diagram while the source stays visible.
 * Anchored to the top-right corner; the header moves it, the corner grip resizes.
 */
export function FloatingCode({ files, file, onSelect, line, dark }: {
  files: Record<string, string>;
  file: string;
  onSelect(name: string): void;
  line: number;
  dark: boolean;
}) {
  const [rect, setRect] = useState({ right: 12, top: 64, width: 480, height: 380 });
  const drag = useRef<{ mode: 'move' | 'resize'; x: number; y: number; right: number; top: number; width: number; height: number } | null>(null);

  const onPointerDown = (mode: 'move' | 'resize') => (event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { mode, x: event.clientX, y: event.clientY, ...rect };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    setRect(current => {
      if (state.mode === 'move') {
        const right = Math.min(Math.max(state.right - dx, 4), Math.max(4, window.innerWidth - state.width - 4));
        const top = Math.min(Math.max(state.top + dy, 4), Math.max(4, window.innerHeight - HEADER_HEIGHT - 4));
        return { ...current, right, top };
      }
      const width = Math.min(Math.max(state.width - dx, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth - state.right - 4));
      const height = Math.min(Math.max(state.height + dy, MIN_HEIGHT), Math.max(MIN_HEIGHT, window.innerHeight - state.top - 4));
      return { ...current, width, height };
    });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    drag.current = null;
  };

  const names = Object.keys(files);
  return <aside className="floating-code" style={{ right: rect.right, top: rect.top, width: rect.width, height: rect.height }} aria-label="浮动代码窗">
    <div className="floating-code-header" onPointerDown={onPointerDown('move')} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <span className="floating-code-dot" aria-hidden="true" />
      {names.length > 1
        ? <select value={file} onChange={event => onSelect(event.target.value)} aria-label="选择查看的源码文件">{names.map(name => <option key={name} value={name}>{name}</option>)}</select>
        : <strong>{file}</strong>}
      <small>拖动标题栏移动 · 左下角调整大小</small>
    </div>
    <div className="floating-code-body">
      <CodeEditor value={files[file] ?? ''} onChange={() => {}} line={line} dark={dark} large={false} readOnly />
    </div>
    <div className="floating-code-grip" onPointerDown={onPointerDown('resize')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} aria-hidden="true" />
  </aside>;
}
