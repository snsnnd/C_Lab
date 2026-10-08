import { useState } from 'react';
import { FileCode, Plus, PencilSimple, Trash, X } from '@phosphor-icons/react';

export function ProjectFiles({ files, active, onSelect, onChange }: {
  files: Record<string, string>;
  active: string;
  onSelect: (name: string) => void;
  onChange: (files: Record<string, string>) => void;
}) {
  const [mode, setMode] = useState<'add' | 'rename' | 'delete' | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const submit = () => {
    const next = name.trim();
    if (mode !== 'delete' && (!/^[a-zA-Z0-9_-]+\.(c|h)$/.test(next) || Object.hasOwn(files, next))) {
      setError('请使用未占用的英文文件名，以 .c 或 .h 结尾。'); return;
    }
    if (mode === 'add' && Object.keys(files).length >= 24) { setError('最多支持 24 个文件。'); return; }
    const updated = { ...files };
    if (mode === 'add') updated[next] = '';
    if (mode === 'rename') { updated[next] = updated[active]; delete updated[active]; }
    if (mode === 'delete') delete updated[active];
    onChange(updated);
    onSelect(mode === 'delete' ? 'main.c' : next);
    setMode(null);
  };
  return <div className="project-files">
    <div className="project-file-row">
      <div className="file-buttons" role="group" aria-label="源码文件">
        {Object.keys(files).map(file => <button key={file} className={`file-tab ${file === active ? 'selected' : ''}`} aria-pressed={file === active} onClick={() => { onSelect(file); setMode(null); }}><FileCode size={16} />{file}</button>)}
      </div>
      <div className="pane-tools">
        <button className="icon-button small" aria-label="新增文件" title="新增文件" onClick={() => { setMode('add'); setName(''); setError(''); }}><Plus size={16} /></button>
        <button className="icon-button small" aria-label="重命名文件" title="重命名文件" disabled={active === 'main.c'} onClick={() => { setMode('rename'); setName(active); setError(''); }}><PencilSimple size={16} /></button>
        <button className="icon-button small" aria-label="删除文件" title="删除文件" disabled={active === 'main.c'} onClick={() => { setMode('delete'); setError(''); }}><Trash size={16} /></button>
      </div>
    </div>
    {mode && <form className="file-form" onSubmit={event => { event.preventDefault(); submit(); }}>
      {mode === 'delete' ? <p>删除 {active}？文件内容会从当前草稿中移除。</p> : <label>{mode === 'add' ? '新文件名' : '新名称'}<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="module.c" aria-label="文件名" /></label>}
      {mode === 'rename' && <small>重命名后，请同步修改引用它的 #include。</small>}
      {error && <p role="alert">{error}</p>}
      <button className="text-button" type="submit">{mode === 'delete' ? '确认删除' : '保存文件名'}</button>
      <button className="icon-button small" type="button" aria-label="取消文件操作" onClick={() => setMode(null)}><X size={16} /></button>
    </form>}
  </div>;
}
