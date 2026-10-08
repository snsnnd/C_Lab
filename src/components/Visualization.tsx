import { useEffect, useRef } from 'react';
import { ArrowRight, ArrowDown, BracketsSquare, Cube, Stack, CursorClick, GitBranch } from '@phosphor-icons/react';
import type { ControlState, Snapshot, Variable } from '../engine/types';

const CONSTRUCT_LABELS: Record<ControlState['construct'], string> = {
  if: '条件判断 if',
  switch: '分支 switch',
  while: '循环 while',
  for: '循环 for',
  do: '循环 do-while',
};

/** The decision that led to this step: conclusion plus every path, greyed when untaken. */
function ControlFlow({ control }: { control: ControlState }) {
  return <section className="control-section" aria-label="控制流" data-testid="control-flow">
    <div className="section-label">
      <GitBranch size={18} />
      <span>{CONSTRUCT_LABELS[control.construct]}</span>
      {control.iteration !== undefined && <span className="control-round">第 {control.iteration} 轮</span>}
      <span className="section-end">未走的路径置灰</span>
    </div>
    <p className="control-result" data-testid="control-result">{control.result}</p>
    <div className="control-branches">
      {control.branches.map(branch => (
        <span key={branch.label} className={`control-branch ${branch.taken ? 'is-taken' : ''}`}>
          {branch.taken ? <ArrowRight size={14} /> : <span className="branch-mark" aria-hidden="true" />}
          <code>{branch.label}</code>
        </span>
      ))}
    </div>
  </section>;
}

function ValueBox({ variable, previous, changed }: { variable: Variable; previous?: Variable; changed: boolean }) {
  const value = variable.enumName ? variable.enumName : variable.value;
  return <div className={`variable-box ${changed ? 'is-changed' : ''} ${variable.freed ? 'is-freed' : ''}`} data-testid={`variable-${variable.name}`}>
    <div className="variable-label"><code>{variable.name}</code><span>{variable.type}</span></div>
    <div className="variable-value" key={value}>{value}</div>
    <div className="variable-meta">
      {variable.freed ? <span className="meta-warning">内存已释放，读取它属于未定义行为</span>
        : changed && previous && previous.value !== variable.value
          ? <><span>{previous.value}</span><ArrowRight size={12} /><span>已更新</span></>
          : <span>{variable.frame} · {changed ? '已创建' : '当前值'}</span>}
    </div>
    {variable.enumName && <div className="variable-note">数值 {variable.value} 对应常量 {variable.enumName}</div>}
  </div>;
}

/** A struct field list: name, type, value, with the byte offset it occupies. */
function RecordBox({ variable, changed }: { variable: Variable; changed: boolean }) {
  return <div className={`record-box ${changed ? 'is-changed' : ''}`} data-testid={`record-${variable.name}`}>
    <div className="record-head"><code>{variable.name}</code><span>{variable.type}</span><span className="record-size">{variable.size} 字节</span></div>
    <div className="record-fields">
      {variable.fields?.map(field => <div className={`record-field ${field.changed ? 'is-changed' : ''}`} key={field.name}>
        <span className="field-offset">+{field.offset}</span>
        <code className="field-name">{field.name}</code>
        <span className="field-type">{field.type}</span>
        <span className="field-value">{field.value}</span>
      </div>)}
      {!variable.fields?.length && <p className="quiet">这个结构体没有字段。</p>}
    </div>
  </div>;
}

export function Visualization({ snapshot, previous, table, ready, platform }: { snapshot?: Snapshot; previous?: Snapshot; table: boolean; ready: boolean; platform?: string }) {
  // Every branch keeps the same root element so React reconciles one subtree
  // instead of swapping between three different roots.
  return <div className="visual-root">
    {!snapshot ? <EmptyState ready={ready} /> : table
      ? <StateTable snapshot={snapshot} />
      : <Diagram snapshot={snapshot} previous={previous} platform={platform} />}
  </div>;
}

function EmptyState({ ready }: { ready: boolean }) {
  return <div className="visual-empty"><div className="empty-mark"><BracketsSquare size={36} weight="light" /></div><h3>{ready ? '等待可观察的状态' : '让代码动起来'}</h3><p>{ready ? '当前没有变量快照。可查看输出或诊断，检查代码是否受支持。' : '点击「运行代码」，在这里看见变量、数组和函数的变化。'}</p><div className="empty-example"><span>代码</span><ArrowRight /><span>执行</span><ArrowRight /><span>看见变化</span></div></div>;
}

function StateTable({ snapshot }: { snapshot: Snapshot }) {
  return <div className="state-table-wrap">{snapshot.control && <p className="table-control" data-testid="control-flow"><GitBranch size={16} /> {snapshot.control.result}</p>}<table className="state-table"><caption>当前停点的变量状态</caption><thead><tr><th>变量</th><th>类型</th><th>值</th><th>函数</th></tr></thead><tbody>{snapshot.variables.map(v => <tr key={v.id} className={snapshot.changes.includes(v.id) ? 'changed-row' : ''}><td><code>{v.name}</code></td><td><code>{v.type}</code></td><td><code>{v.enumName ?? v.value}</code>{v.fields?.length ? <ul className="field-list">{v.fields.map(f => <li key={f.name}><code>{f.name}</code> = <code>{f.value}</code> <span className="field-offset">+{f.offset}</span></li>)}</ul> : null}</td><td>{v.frame}</td></tr>)}</tbody></table>{snapshot.returned && <p className="table-return"><GitBranch size={14} /> {snapshot.returned.name}() 返回 {snapshot.returned.value}</p>}{!snapshot.variables.length && <p className="quiet">当前停点尚无已声明的变量。</p>}</div>;
}

function Diagram({ snapshot, previous, platform }: { snapshot: Snapshot; previous?: Snapshot; platform?: string }) {
  const arrays = snapshot.variables.filter(v => v.kind === 'array');
  const records = snapshot.variables.filter(v => v.kind === 'struct');
  const scalars = snapshot.variables.filter(v => v.kind === 'scalar' || v.kind === 'enum');
  const pointers = snapshot.variables.filter(v => v.kind === 'pointer' || v.kind === 'heap');
  const frameOrder = snapshot.frames.map(f => f.name);
  const frameGroups: { label: string; items: typeof scalars }[] = [];
  for (const variable of scalars) {
    const label = variable.frame || '其他';
    let group = frameGroups.find(item => item.label === label);
    if (!group) { group = { label, items: [] }; frameGroups.push(group); }
    group.items.push(variable);
  }
  frameGroups.sort((a, b) => {
    const ia = frameOrder.indexOf(a.label);
    const ib = frameOrder.indexOf(b.label);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.label.startsWith('全局') ? 1 : b.label.startsWith('全局') ? -1 : 0;
  });
  const cursor = scalars.find(v => ['i', 'index', 'j'].includes(v.name) && /^\d+$/.test(v.value));
  const diagram = useRef<HTMLDivElement>(null);
  // Keep the array and the object that changed this step inside the visible area.
  useEffect(() => {
    const root = diagram.current;
    const scroller = root?.closest<HTMLElement>('.visual-content');
    if (!snapshot || !root || !scroller) return;
    const targets = [
      root.querySelector<HTMLElement>('.array-section'),
      root.querySelector<HTMLElement>('.is-changed'),
    ].filter((el): el is HTMLElement => !!el);
    if (!targets.length) return;
    const cell = root.querySelector<HTMLElement>('.is-indexed');
    const track = cell?.closest<HTMLElement>('.array-scroll');
    if (cell && track && track.scrollWidth > track.clientWidth) {
      track.scrollTo({ left: Math.max(0, cell.offsetLeft - (track.clientWidth - cell.offsetWidth) / 2) });
    }
    const overflow = targets.at(-1)!.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 12;
    if (overflow > 0) scroller.scrollTop += overflow;
  }, [snapshot?.index]);
  return <div className="diagram" ref={diagram}>
    <div className="diagram-caption"><span className="status-dot" />当前停点的状态<span className="diagram-caption-right">第 {snapshot.line} 行</span></div>
    {snapshot.control && <ControlFlow control={snapshot.control} />}
    {arrays.map(array => {
      const old = previous?.variables.find(v => v.id === array.id);
      const cursorIndex = cursor ? Number(cursor.value) : -1;
      const inRange = cursorIndex >= 0 && cursorIndex < (array.elements?.length ?? 0);
      const shape = array.shape;
      const columns = shape?.length === 2 ? shape[1] : 0;
      const rows = columns ? Math.min(shape![0], Math.floor(64 / columns)) : 0;
      const cellClass = (flat: number) => `array-item ${!columns && inRange && flat === cursorIndex ? 'is-indexed' : ''} ${old?.elements?.[flat] !== undefined && old.elements[flat] !== array.elements?.[flat] ? 'is-changed' : ''}`;
      return <section className="array-section" key={array.id} aria-label={`数组 ${array.name}`}>
        <div className="section-label"><BracketsSquare size={18} /><code>{array.name}</code><span>{array.type}</span><span className="section-end">{columns ? `形状 ${shape![0]} × ${columns}` : `${array.length} 个元素`}</span></div>
        {columns ? <div className="array-grid" aria-label={`${array.name} 的行列网格`}>
          <div className="array-grid-row array-grid-head"><span className="array-row-label" />{Array.from({ length: columns }, (_, c) => <code key={c} className="array-col-head">[{c}]</code>)}</div>
          {Array.from({ length: rows }, (_, r) => <div className="array-grid-row" key={r}>
            <code className="array-row-label">{r}</code>
            {Array.from({ length: columns }, (_, c) => {
              const flat = r * columns + c;
              const value = array.elements?.[flat];
              return <div className={cellClass(flat)} key={c}><div className="array-cell"><span key={value ?? ''}>{value}</span></div><code className="array-index">[{r}][{c}]</code></div>;
            })}
          </div>)}
        </div>
        : <div className="array-scroll"><div className="array-track">
          {inRange && cursor && <div className="array-cursor" style={{ transform: `translateX(calc(${cursorIndex} * (var(--cell-size) + 8px)))` }}><code>{cursor.name} = {cursor.value}</code><ArrowDown size={18} weight="bold" /></div>}
          <div className="array-cells">{array.elements?.map((value, i) => <div className={cellClass(i)} key={i}><div className="array-cell"><span key={value}>{value}</span></div><code className="array-index">[{i}]</code></div>)}</div>
        </div></div>}
        <div className="array-note">{columns
          ? <><span className="mini-square" />行主序：每行 {columns} 个元素在内存里连续存放，按 a[行][列] 访问</>
          : <>{cursor ? <><CursorClick size={14} />{cursor.name} = {cursor.value} · 索引变量参考{!inRange && '，当前不在已显示元素范围内'}</> : <><span className="mini-square" />每格一个元素，下方是从 0 开始的索引</>}</>}
          {(array.length ?? 0) > 64 && <span>仅显示前 64 项</span>}</div>
      </section>;
    })}
    {pointers.length > 0 && <section className="pointer-section" aria-label="指向关系"><div className="section-label"><ArrowRight size={18} /><span>指向关系</span><span className="section-end">逻辑对象，不是机器地址</span></div>{pointers.map(pointer => {
      const target = snapshot.variables.find(v => v.id === pointer.target);
      return <div className="pointer-row" key={pointer.id}><div className={`pointer-box ${pointer.freed ? 'is-freed' : ''}`}><code>{pointer.type}</code><strong>{pointer.name}</strong></div><div className="pointer-link"><span>{pointer.value === '空指针 NULL' ? '不指向' : '指向'}</span><svg viewBox="0 0 120 32" aria-hidden="true"><path d="M 2 16 H 110 M 102 9 L 111 16 L 102 23" /></svg></div><div className={`pointer-target ${target && snapshot.changes.includes(target.id) ? 'is-changed' : ''}`}><code>{pointer.targetName ?? pointer.value}</code><strong>{target ? (target.enumName ?? target.value) : '—'}</strong></div>{pointer.targetLabel && <p className="pointer-note">{pointer.targetLabel}</p>}</div>;
    })}</section>}
    {records.length > 0 && <section className="records-section" aria-label="结构体"><div className="section-label"><BracketsSquare size={18} /><span>结构体</span><span className="section-end"><span className="change-dot" />本步变化的字段会高亮</span></div><div className="records-grid">{records.map(variable => <RecordBox key={variable.id} variable={variable} changed={snapshot.changes.includes(variable.id)} />)}</div></section>}
    {scalars.length > 0 && <section className="variables-section"><div className="section-label"><Cube size={18} /><span>变量</span><span className="section-end"><span className="change-dot" />本步变化 · 按函数分组</span></div>{frameGroups.map(group => <div className="frame-group" key={group.label}><div className="frame-group-label"><Stack size={13} /><code>{group.label}</code></div><div className="variables-grid">{group.items.map(variable => <ValueBox key={variable.id} variable={variable} previous={previous?.variables.find(v => v.id === variable.id)} changed={snapshot.changes.includes(variable.id)} />)}</div></div>)}</section>}
    {snapshot.frames.length > 1 && <section className="frames-section" aria-label="函数调用"><div className="section-label"><Stack size={18} /><span>函数调用</span><span className="section-end">当前活动调用</span></div><div className="frame-list">{snapshot.frames.map((frame, i) => <div className="frame-entry" key={frame.id}>{i > 0 && <ArrowRight size={16} />}<span className={i === snapshot.frames.length - 1 ? 'current-frame' : ''}><span className="frame-depth">{i + 1}</span><code>{frame.name}()</code></span></div>)}</div></section>}
    {snapshot.returned && <div className="return-badge" role="status" aria-label="函数返回值"><ArrowRight size={14} /><code>{snapshot.returned.name}()</code><span>返回</span><code className="return-value">{snapshot.returned.value}</code></div>}
    {!snapshot.variables.length && <div className="no-variables"><Cube size={28} weight="light" /><p>尚无局部变量</p><span>继续下一步，或在下方查看程序输出。</span></div>}
    <div className="diagram-footnote">由本次真实执行生成 · 方框与箭头是教学表示{platform ? ` · ${platform}` : ''}</div>
  </div>;
}
