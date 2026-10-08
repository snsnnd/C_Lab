import { X } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { SHORTCUTS } from '../lib/shortcuts';

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="overlay centered" onClick={onClose}>
    <section className="modal shortcut-modal" role="dialog" aria-modal="true" aria-labelledby="shortcut-title" onClick={e => e.stopPropagation()} onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); close.current?.focus(); } }}>
      <div className="modal-header">
        <h2 id="shortcut-title">键盘快捷键</h2>
        <button ref={close} className="icon-button" onClick={onClose} aria-label="关闭快捷键面板"><X size={22} /></button>
      </div>
      <table className="shortcut-table">
        <tbody>
          {SHORTCUTS.map((item, index) => <tr key={`${item.action}-${item.keys}-${index}`}>
            <td><kbd>{item.keys}</kbd></td>
            <td>
              <span className="shortcut-label">{item.label}</span>
              {item.note && <small className="shortcut-note">{item.note}</small>}
            </td>
          </tr>)}
        </tbody>
      </table>
      <p className="shortcut-hint">在代码编辑器里输入时，空格、方向键与 Home / End 都属于文本，不会被当作播放控制；此时用 <kbd>Alt</kbd> + <kbd>←</kbd> / <kbd>→</kbd> 单步。</p>
    </section>
  </div>;
}
