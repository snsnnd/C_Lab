import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowClockwise, ArrowDown, ArrowRight, ArrowsIn, ArrowsOut, BookOpen, Broadcast, CaretDown, CaretLeft, CaretRight,
  Check, CheckCircle, Clock, Code, DownloadSimple, FileCode, Info, Lightbulb,
  Moon, Pause, Play, Presentation, SkipBack, SkipForward, SlidersHorizontal,
  SpinnerGap, Square, Sun, TerminalWindow, UploadSimple, WarningCircle, X,
} from '@phosphor-icons/react';
import { CodeEditor } from './components/CodeEditor';
import { Visualization } from './components/Visualization';
import { FadeContent } from './components/FadeContent';
import { ShortcutHelp } from './components/ShortcutHelp';
import { ProjectFiles } from './components/ProjectFiles';
import { FloatingCode } from './components/FloatingCode';
import { validateFiles } from './engine/project';
import { isTypingTarget, matchShortcut } from './lib/shortcuts';
import { clearDraftBackup, joinUrl, joinUrlOn, keepDraftBackup, loadDraftBackup, normalizeRoom, ROOM_PATTERN, type StepMessage, type WorkspaceMessage } from './lib/classroom';
import { lessons, type Lesson } from './data/lessons';
import { useRunner } from './hooks/useRunner';
import { usePaneFullscreen } from './hooks/usePaneFullscreen';
import { useClassroom } from './hooks/useClassroom';
import type { Trace } from './engine/types';

interface Draft { code: string; input: string; files?: Record<string, string> }
const STORAGE = 'c-lab-workspace-v1';

function readWorkspace(): { lessonId?: string; drafts?: Record<string, Draft>; completed?: string[]; dark?: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    if (!value || typeof value !== 'object') return {};
    const drafts: Record<string, Draft> = {};
    for (const lesson of lessons) {
      const draft = value.drafts?.[lesson.id];
      if (typeof draft?.code === 'string' && typeof draft.input === 'string') {
        if (draft.files) validateFiles({ ...draft.files, 'main.c': draft.code });
        drafts[lesson.id] = draft;
      }
    }
    return { lessonId: value.lessonId, drafts, completed: Array.isArray(value.completed) ? value.completed.filter((v: unknown) => typeof v === 'string') : [], dark: value.dark === true };
  } catch { return {}; }
}

export default function App() {
  const [saved] = useState(readWorkspace);
  const [lessonId, setLessonId] = useState(() => lessons.find(l => l.id === saved.lessonId)?.id ?? 'arrays');
  const lesson = lessons.find(l => l.id === lessonId)!;
  const lessonIndex = lessons.indexOf(lesson);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(saved.drafts ?? {});
  const draft = drafts[lessonId] ?? { code: lesson.code, input: lesson.input, files: lesson.files };
  const files = useMemo<Record<string, string>>(() => ({ ...draft.files, 'main.c': draft.code }), [draft.files, draft.code]);
  const project = Object.keys(files).length > 1 ? files : undefined;
  const [activeFile, setActiveFile] = useState('main.c');
  const editorFile = Object.hasOwn(files, activeFile) ? activeFile : 'main.c';
  const editorCode = files[editorFile];
  const [completed, setCompleted] = useState<string[]>(saved.completed ?? []);
  const [dark, setDark] = useState(saved.dark ?? false);
  const [large, setLarge] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [info, setInfo] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [classroomOpen, setClassroomOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  // Viewer joined a room but no workspace has arrived yet (teacher not sharing).
  const [awaitingWorkspace, setAwaitingWorkspace] = useState(false);
  const [classroomInfo, setClassroomInfo] = useState<{ port?: number; addresses?: string[] } | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<'lab' | 'notes'>('lab');
  const [visualTable, setVisualTable] = useState(false);
  const [mobileTab, setMobileTab] = useState<'code' | 'visual'>('code');
  const [consoleTab, setConsoleTab] = useState<'output' | 'input' | 'diagnostics'>('output');
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const pendingStep = useRef<number | null>(null);
  const traceReady = useRef(false);
  const [speed, setSpeed] = useState(1);
  const [answer, setAnswer] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState('');
  const fullscreen = usePaneFullscreen(setNotice);
  const maxPane = fullscreen.active;
  const fileInput = useRef<HTMLInputElement>(null);
  // Group order follows the lesson list so new lessons never need a code change here.
  const groups = lessons.reduce<string[]>((all, item) => (all.includes(item.group) ? all : [...all, item.group]), []);
  const initial = useRef(false);
  const runner = useRunner();
  const stale = !!runner.trace && (runner.trace.source !== draft.code || runner.trace.input !== draft.input || JSON.stringify(runner.trace.files) !== JSON.stringify(project));
  const snapshots = runner.trace?.snapshots ?? [];
  const snapshot = snapshots[step];
  const last = step >= snapshots.length - 1;
  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;
  useEffect(() => {
    if (!stale && snapshot?.file) setActiveFile(snapshot.file);
  }, [step, runner.trace, stale]);

  // Viewer side: replace the current workspace with the teacher's, then follow steps.
  const applyWorkspace = (message: WorkspaceMessage) => {
    setAwaitingWorkspace(false);
    const code = message.files['main.c'] ?? '';
    const { 'main.c': _main, ...extra } = message.files;
    const target = lessons.some(item => item.id === message.lessonId) ? message.lessonId : lessonId;
    setLessonId(target);
    setDrafts(all => ({ ...all, [target]: { code, files: Object.keys(extra).length ? extra : undefined, input: message.input } }));
    setActiveFile('main.c');
    setPlaying(false);
    setStep(0);
    setAnswer(false);
    pendingStep.current = null;
    traceReady.current = false;
    runner.run(code, message.input, trace => {
      traceReady.current = true;
      const pending = pendingStep.current;
      if (pending !== null) setStep(Math.max(0, Math.min(pending, Math.max(0, trace.snapshots.length - 1))));
    }, Object.keys(message.files).length > 1 ? message.files : undefined);
  };

  const applyStep = (message: StepMessage) => {
    setPlaying(false);
    if (!traceReady.current) { pendingStep.current = message.step; return; }
    setStep(Math.max(0, Math.min(message.step, Math.max(0, snapshotsRef.current.length - 1))));
  };

  const classroom = useClassroom({
    onWorkspace: message => applyWorkspace(message),
    onStep: message => applyStep(message),
  });
  const following = classroom.role === 'viewer';
  const lastWorkspace = useRef('');

  // Joining a classroom replaces the local drafts as the teacher shares; keep a
  // backup so leaving follow mode gives the student their own work back.
  const enterClassroom = (room: string) => {
    keepDraftBackup(room, drafts);
    classroom.joinRoom(room);
    setAwaitingWorkspace(true);
    setNotice(`已加入课堂 ${room}，本机代码已备份，退出跟随后自动恢复。`);
  };

  const leaveClassroom = () => {
    const backup = loadDraftBackup<Record<string, Draft>>();
    clearDraftBackup();
    if (backup) setDrafts(backup.drafts);
    classroom.leave(() => setNotice(backup ? '已退出跟随，已恢复你自己的代码。' : '已退出跟随，可以自由编辑了。'));
  };

  useEffect(() => {
    // Host side: publish the whole workspace (debounced) whenever it changes.
    if (classroom.role !== 'host') { lastWorkspace.current = ''; return; }
    const payload = JSON.stringify({ lessonId, files, input: draft.input });
    if (payload === lastWorkspace.current) return;
    const timer = setTimeout(() => {
      lastWorkspace.current = payload;
      void classroom.publish({ type: 'workspace', lessonId, files, input: draft.input });
    }, 400);
    return () => clearTimeout(timer);
  }, [classroom.role, classroom.publish, lessonId, files, draft.input]);

  useEffect(() => {
    // Host side: step messages are tiny, so a trailing throttle is enough.
    if (classroom.role !== 'host') return;
    const timer = setTimeout(() => { void classroom.publish({ type: 'step', step, playing }); }, 80);
    return () => clearTimeout(timer);
  }, [classroom.role, classroom.publish, step, playing]);

  const shareLinks = useMemo(() => {
    if (!classroom.room) return [];
    const own = joinUrl(location.href, classroom.room);
    const onLocalhost = ['localhost', '127.0.0.1', '::1', ''].includes(location.hostname);
    const addresses = Array.isArray(classroomInfo?.addresses) ? classroomInfo.addresses : [];
    const lan = addresses.map(address => joinUrlOn(location.href, classroom.room, address, classroomInfo?.port));
    const ordered = onLocalhost ? lan : [own, ...lan];
    return [...new Set(ordered.length ? ordered : [own])];
  }, [classroom.room, classroomInfo]);

  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('join');
    if (requested) {
      const room = normalizeRoom(requested);
      if (ROOM_PATTERN.test(room)) enterClassroom(room);
      else setNotice('课堂码无效，请向老师确认链接。');
      return;
    }
    // Closed during class without leaving follow mode: recover the backup.
    const backup = loadDraftBackup<Record<string, Draft>>();
    if (backup) {
      clearDraftBackup();
      setDrafts(backup.drafts);
      setNotice('已恢复上次课堂前备份的本机代码。');
    }
  // Join once from the shared link; reconnects are handled by EventSource.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // The teacher usually opens localhost; ask the server for LAN addresses so
    // the share link works on student devices.
    if (classroom.role !== 'host') { setClassroomInfo(null); return; }
    let cancelled = false;
    fetch('/api/info').then(response => response.ok ? response.json() : null).then(info => {
      if (!cancelled && info) setClassroomInfo(info);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [classroom.role]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'normal';
  }, [dark, reduced]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify({ lessonId, drafts, completed, dark })); setStorageError(false); }
    catch { setStorageError(true); }
  }, [lessonId, drafts, completed, dark]);

  const onReady = useCallback((trace: Trace) => {
    setStep(0);
    setPlaying(false);
    if (trace.error) { setConsoleTab('diagnostics'); setConsoleOpen(true); }
    else setConsoleTab('output');
  }, []);

  const runCode = useCallback(() => {
    if (classroom.role === 'viewer') { setNotice('正在跟随课堂，点击「退出跟随」后可自行运行。'); return; }
    setPlaying(false);
    runner.run(draft.code, draft.input, onReady, project);
  }, [classroom.role, draft.code, draft.input, project, runner.run, onReady]);

  const jumpToError = useCallback(() => {
    const trace = runner.trace;
    const file = trace?.errorFile ?? 'main.c';
    if (stale || !trace?.errorLine || !Object.hasOwn(files, file)) return;
    setPlaying(false);
    setWorkspaceTab('lab');
    setMobileTab('code');
    setActiveFile(file);
  }, [files, runner.trace, stale]);

  useEffect(() => {
    // One initial run supplies an immediately explorable, genuinely computed scene.
    if (!initial.current) {
      initial.current = true;
      const timer = setTimeout(() => runner.run(draft.code, draft.input, trace => {
        onReady(trace);
        const start = trace.snapshots.findIndex(s => s.variables.some(v => v.kind === 'array') && s.variables.some(v => v.name === 'i'));
        if (start >= 0) setStep(start);
      }, project), 100);
      return () => { clearTimeout(timer); initial.current = false; };
    }
  // The initial example should not rerun on every edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRun || !stale) return;
    const timer = setTimeout(runCode, 800);
    return () => clearTimeout(timer);
  }, [autoRun, stale, runCode]);

  useEffect(() => {
    if (!playing || stale || runner.running) return;
    if (last) { setPlaying(false); return; }
    const timer = setTimeout(() => setStep(s => Math.min(s + 1, snapshots.length - 1)), 900 / speed);
    return () => clearTimeout(timer);
  }, [playing, step, speed, stale, runner.running, last, snapshots.length]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3600);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      const action = matchShortcut({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey, alt: event.altKey, typing: isTypingTarget(event.target) });
      if (!action) return;
      if (action === 'escape') { setDrawer(false); setSettings(false); setInfo(false); setResetConfirm(false); setShortcuts(false); setClassroomOpen(false); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); return; }
      if (action === 'help') { event.preventDefault(); setShortcuts(value => !value); return; }
      if (drawer || info || resetConfirm || shortcuts || settings || classroomOpen) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === 'run') { if (!event.repeat) runCode(); return; }
      if (action === 'stop') { setPlaying(false); if (runner.running) runner.cancel(); return; }
      if (!snapshots.length || stale || runner.running || workspaceTab !== 'lab') return;
      if (action === 'toggle-play') { if (event.repeat) return; if (last) setStep(0); setPlaying(value => !value); return; }
      setPlaying(false);
      if (action === 'next') setStep(value => Math.min(value + 1, snapshots.length - 1));
      if (action === 'prev') setStep(value => Math.max(0, value - 1));
      if (action === 'first') setStep(0);
      if (action === 'last') setStep(snapshots.length - 1);
    };
    window.addEventListener('keydown', handle, true);
    return () => window.removeEventListener('keydown', handle, true);
  }, [runCode, runner.cancel, runner.running, snapshots.length, stale, last, workspaceTab, drawer, info, resetConfirm, shortcuts, settings, classroomOpen]);

  const updateDraft = (patch: Partial<Draft>) => {
    if (classroom.role === 'viewer') { setNotice('正在跟随课堂，代码与输入暂不可改。'); return; }
    if (runner.running) runner.cancel();
    setPlaying(false);
    setDrafts(all => ({ ...all, [lessonId]: { ...draft, ...patch } }));
  };

  const selectLesson = (next: Lesson) => {
    if (classroom.role === 'viewer') { setNotice('正在跟随课堂，请先退出跟随再切换课程。'); setDrawer(false); return; }
    runner.reset();
    setLessonId(next.id);
    setActiveFile('main.c');
    setPlaying(false);
    setStep(0);
    setAnswer(false);
    setDrawer(false);
    setWorkspaceTab('lab');
    setConsoleTab(next.id === 'input' ? 'input' : 'output');
  };

  const jump = (index: number) => { setPlaying(false); setStep(Math.max(0, Math.min(index, snapshots.length - 1))); };
  const playable = snapshots.length > 0 && !stale && !runner.running && !following;
  const download = () => {
    const url = URL.createObjectURL(new Blob([project ? JSON.stringify({ files: project, input: draft.input }, null, 2) : draft.code], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${lesson.id}.${project ? 'json' : 'c'}`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(project ? '完整项目已导出为 JSON，可再次导入。' : 'C 源码已导出。');
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    if (file.size > 128000) { setNotice('导入文件超过 128 KB。'); return; }
    try {
      const text = await file.text();
      if (file.name.endsWith('.json')) {
        const value = JSON.parse(text);
        validateFiles(value.files);
        if (typeof value.files['main.c'] !== 'string') throw new Error('项目必须包含 main.c。');
        const { 'main.c': code, ...extra } = value.files;
        updateDraft({ code, files: extra, input: typeof value.input === 'string' ? value.input : '' });
        setActiveFile('main.c');
      } else if (editorFile === 'main.c') updateDraft({ code: text });
      else updateDraft({ files: { ...draft.files, [editorFile]: text } });
      setNotice('源码已导入，点击运行查看结果。');
    } catch (error) { setNotice(`导入失败：${error instanceof Error ? error.message : String(error)}`); }
  };

  return <div className={`app ${large ? 'presentation' : ''}`}>
    <header className="app-header">
      <button className="brand" onClick={() => setDrawer(true)} aria-label="打开课程目录"><span className="brand-symbol">C<span>·</span></span><span>C Lab<span className="brand-divider">/</span><span className="brand-subtitle">C 语言实验室</span></span></button>
      <nav className="header-actions" aria-label="工作台操作">
        <span className="local-badge"><span className="status-dot" />浏览器本地运行</span>
        <button className="text-button" onClick={() => setDrawer(true)}><BookOpen size={18} />课程目录</button>
        <button className={`icon-button ${classroom.role !== 'off' ? 'active' : ''}`} onClick={() => setClassroomOpen(!classroomOpen)} aria-label="课堂同步" aria-pressed={classroom.role !== 'off'} title="课堂同步"><Broadcast size={20} />{classroom.role === 'host' && classroom.viewers > 0 && <span className="classroom-badge">{classroom.viewers}</span>}</button>
        <button className={`icon-button ${large ? 'active' : ''}`} onClick={() => setLarge(!large)} aria-label="切换投屏模式" title="投屏模式" aria-pressed={large}><Presentation size={20} /></button>
        <button className="icon-button" onClick={() => setDark(!dark)} aria-label={dark ? '切换浅色主题' : '切换深色主题'} title="切换主题">{dark ? <Sun size={20} /> : <Moon size={20} />}</button>
        <button className="icon-button" onClick={() => setSettings(!settings)} aria-label="学习设置" title="学习设置"><SlidersHorizontal size={20} /></button>
      </nav>
    </header>

    <section className="lesson-heading">
      <div className="lesson-title-group"><button className="lesson-number" onClick={() => setDrawer(true)} aria-label="选择课程">{lesson.number}<CaretDown size={12} /></button><div><h1>{lesson.title}</h1><p>{lesson.subtitle}</p></div></div>
      <div className="lesson-context"><div className="lesson-tags">{lesson.tags.map(tag => <span key={tag}>{tag}</span>)}<span className="lesson-time"><Clock size={14} />{lesson.time}</span></div><div className="lesson-navigation"><button className="icon-button" disabled={lessonIndex === 0} onClick={() => selectLesson(lessons[lessonIndex - 1])} aria-label="上一课"><CaretLeft /></button><span>{lessonIndex + 1} / {lessons.length}</span><button className="icon-button" disabled={lessonIndex === lessons.length - 1} onClick={() => selectLesson(lessons[lessonIndex + 1])} aria-label="下一课"><CaretRight /></button></div></div>
    </section>

    <main className="workbench">
      {following && <div className="follow-banner" role="status" data-testid="follow-banner">
        <Broadcast size={16} />
        <span>正在跟随课堂 <strong>{classroom.room}</strong>，页面只读。</span>
        <span className="follow-status">{classroom.status === 'error' ? '连接中断，正在自动重试…' : classroom.status !== 'live' ? '正在连接…' : awaitingWorkspace ? '等待老师开始共享…' : '已连接'}</span>
        <button className="text-button" data-testid="leave-follow" onClick={leaveClassroom}>退出跟随</button>
      </div>}
      <div className="workspace-toolbar">
        <div className="workspace-tabs" role="tablist" aria-label="课程内容"><button role="tab" aria-selected={workspaceTab === 'lab'} className={workspaceTab === 'lab' ? 'selected' : ''} onClick={() => setWorkspaceTab('lab')}><Code size={18} />代码实验</button><button role="tab" aria-selected={workspaceTab === 'notes'} className={workspaceTab === 'notes' ? 'selected' : ''} onClick={() => setWorkspaceTab('notes')}><BookOpen size={18} />本课讲义</button></div>
        <div className="run-actions"><label className="auto-run"><input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} />自动运行</label><button className="text-button restore-button" disabled={following} onClick={() => setResetConfirm(true)}><ArrowClockwise size={16} />恢复示例</button>{runner.running ? <button className="run-button stop" onClick={runner.cancel}><Square size={15} weight="fill" />停止执行</button> : <button className="run-button" onClick={runCode} disabled={following} title={following ? '跟随课堂时只读' : 'Ctrl / ⌘ + Enter'}><Play size={17} weight="fill" />运行代码<span className="key-hint">⌘ ↵</span></button>}</div>
      </div>

      {workspaceTab === 'notes' ? <FadeContent key={lessonId} className="lesson-notes"><div className="notes-content"><h2>这一课，我们观察什么？</h2><p className="notes-intro">{lesson.intro}</p>{lesson.concepts.map((concept, i) => <section key={concept.title}><span className="concept-number">{i + 1}</span><div><h3>{concept.title}</h3><p>{concept.text}</p></div></section>)}{lesson.pitfalls && lesson.pitfalls.length > 0 && <section key="pitfalls"><span className="concept-number pitfall">!</span><div><h3>常见的坑</h3><ul className="pitfall-list">{lesson.pitfalls.map(item => <li key={item}>{item}</li>)}</ul></div></section>}{lesson.deeper && lesson.deeper.map(item => <section key={item.title}><span className="concept-number deeper">＋</span><div><h3>{item.title}</h3><p>{item.text}</p></div></section>)}<div className="prediction"><Lightbulb size={23} /><div><h3>先预测，再运行</h3><p>{lesson.prediction}</p><button className="inline-button" onClick={() => setAnswer(!answer)}>{answer ? '收起参考解释' : '看看参考解释'}<CaretDown size={14} /></button>{answer && <p className="answer">{lesson.answer}</p>}</div></div><div className="challenge"><h3>动手试一试</h3><p>{lesson.challenge}</p><button className="run-button" onClick={() => setWorkspaceTab('lab')}>回到代码实验<ArrowRight size={17} /></button></div><button className={`completion-button ${completed.includes(lessonId) ? 'completed' : ''}`} onClick={() => setCompleted(all => all.includes(lessonId) ? all.filter(id => id !== lessonId) : [...all, lessonId])}><CheckCircle size={20} weight={completed.includes(lessonId) ? 'fill' : 'regular'} />{completed.includes(lessonId) ? '已学完本课 · 点击撤销' : '我能解释这个过程，标记学完'}</button></div><aside className="notes-side"><span className="notes-side-symbol">C</span><h3>学习不止于运行成功</h3><p>暂停一步，解释一次变化。<br />修改一个条件，再验证你的预测。</p><div className="learning-steps"><span>预测</span><ArrowDown size={15} /><span>观察</span><ArrowDown size={15} /><span>解释</span><ArrowDown size={15} /><span>修改</span></div></aside></FadeContent> : <>
        <div className="mobile-pane-tabs"><button className={mobileTab === 'code' ? 'selected' : ''} onClick={() => setMobileTab('code')}>代码</button><button className={mobileTab === 'visual' ? 'selected' : ''} onClick={() => setMobileTab('visual')}>可视化</button></div>
        <div className={`panes show-${mobileTab}`}>
          <section ref={fullscreen.editor} className="editor-pane" aria-label="源码区">
            <div className="pane-header"><div className="file-tab"><FileCode size={17} /><span>{editorFile}</span><span className={`file-dot ${stale ? 'dirty' : ''}`} /></div><div className="pane-tools"><button className="icon-button small" onClick={() => void fullscreen.toggle('editor')} aria-label={maxPane === 'editor' ? '还原代码区' : '代码区全屏'} aria-pressed={maxPane === 'editor'} title={maxPane === 'editor' ? '还原（Esc）' : '代码区全屏'}>{maxPane === 'editor' ? <ArrowsIn size={17} /> : <ArrowsOut size={17} />}</button><span className="language-tag">{project ? `${Object.keys(files).length} 个文件` : 'C'}</span><button className="icon-button small" onClick={() => fileInput.current?.click()} aria-label="导入 C 源码" title="导入当前文件 / JSON 项目"><UploadSimple size={17} /></button><button className="icon-button small" onClick={download} aria-label="导出 C 源码" title={project ? '导出完整 JSON 项目' : '导出 C 源码'}><DownloadSimple size={17} /></button><input ref={fileInput} type="file" accept=".c,.h,.txt,.json" onChange={importFile} hidden /></div></div>
            <ProjectFiles key={lessonId} files={{ 'main.c': draft.code, ...draft.files }} active={editorFile} onSelect={file => { setPlaying(false); setActiveFile(file); }} onChange={updated => { const { 'main.c': code, ...extra } = updated; updateDraft({ code, files: extra }); }} />
             <div className="editor-container"><CodeEditor key={`${lessonId}:${editorFile}`} value={editorCode} onChange={code => editorFile === 'main.c' ? updateDraft({ code }) : updateDraft({ files: { ...draft.files, [editorFile]: code } })} line={!stale && snapshot && (snapshot.file ?? 'main.c') === editorFile ? snapshot.line : 0} errorLine={!stale && runner.trace?.error && (runner.trace.errorFile ?? 'main.c') === editorFile ? runner.trace.errorLine : 0} dark={dark} large={large} readOnly={following} /></div>
            <div className="editor-status"><span>{storageError ? '保存失败，请导出源码' : <><Check size={12} />本地已保存</>}</span><span>UTF-8<span className="status-divider">·</span>{editorCode.split('\n').length} 行</span></div>
          </section>
          <section ref={fullscreen.visual} className="visual-pane" aria-label="运行可视化"><div className="pane-header"><div className="pane-title"><span className="visual-symbol"><Square size={13} /><Square size={13} /></span><h2>运行可视化</h2></div><div className="view-switch" aria-label="可视化视图"><button className={!visualTable ? 'selected' : ''} onClick={() => setVisualTable(false)} aria-pressed={!visualTable}>图示</button><button className={visualTable ? 'selected' : ''} onClick={() => setVisualTable(true)} aria-pressed={visualTable}>状态表</button></div><button className="icon-button small" onClick={() => void fullscreen.toggle('visual')} aria-label={maxPane === 'visual' ? '还原可视化' : '可视化全屏'} aria-pressed={maxPane === 'visual'} title={maxPane === 'visual' ? '还原（Esc）' : '可视化全屏'}>{maxPane === 'visual' ? <ArrowsIn size={17} /> : <ArrowsOut size={17} />}</button></div>
            {stale && <div className="stale-banner"><WarningCircle size={16} />代码或输入已修改，图示来自上次运行。</div>}
            {(runner.trace?.droppedSnapshots ?? 0) > 0 && <div className="stale-banner" role="status"><WarningCircle size={16} />本程序共 {runner.trace?.totalSnapshots} 步：最早的 {runner.trace?.droppedSnapshots} 步已滚动移出，当前展示最近 {snapshots.length} 步（回到第一步即窗口起点）。</div>}
            {runner.running && <div className="running-banner"><SpinnerGap className="spin" size={16} />正在生成执行轨迹…</div>}
            {project && <div className="module-context" aria-label="模块关系">
              <strong>当前停点：{snapshot?.file ?? '等待运行'}{snapshot && ` · 第 ${snapshot.line} 行`}</strong>
              <div>调用所在文件：{snapshot?.frames.map(frame => `${frame.name}()${frame.file ? ` · ${frame.file}` : ''}`).join(' → ') || '等待运行'}</div>
              <details><summary>源码包含关系（不代表调用顺序）</summary>{Object.entries(files).map(([file, code]) => <div key={file}><code>{file}</code> → {[...code.matchAll(/^\s*#\s*include\s+"([^"]+)"/gm)].map(match => match[1]).join('、') || '无本地头文件依赖'}</div>)}</details>
            </div>}
            <div className={`visual-content ${stale ? 'is-stale' : ''}`}>
              {runner.trace?.preprocessed && <details className="preprocessor-output"><summary>查看预处理结果（运行前）</summary><p>这里是展开宏、包含头文件并选择条件分支后的代码。宏不会产生函数调用帧；回放仍定位到左侧原始源码。</p>{runner.trace.preprocessed.map(unit => <details key={unit.file}><summary>{unit.file} · 展开后的翻译单元</summary><pre aria-label={`${unit.file} 预处理结果`}>{unit.source}</pre></details>)}</details>}
              <Visualization snapshot={snapshot} previous={snapshots[step - 1]} table={visualTable} ready={!!runner.trace} platform={runner.trace?.platform?.label} />
            </div>
            <div className="step-explanation" aria-live={playing ? 'off' : 'polite'}><span className="step-icon"><Lightbulb size={19} /></span><div><span className="explanation-label">{snapshot ? '这一步，发生了什么' : '观察提示'}</span><p>{snapshot?.description ?? '先预测结果，再运行代码。每一步都可以暂停、回看。'}</p></div></div>
            {maxPane === 'visual' && <FloatingCode files={files} file={editorFile} onSelect={file => { setPlaying(false); setActiveFile(file); }} line={!stale && snapshot && (snapshot.file ?? 'main.c') === editorFile ? snapshot.line : 0} dark={dark} />}
            {maxPane === 'visual' && <div className="fullscreen-transport" aria-label="全屏播放控制">
              <button className="text-button" disabled={!playable || step === 0} onClick={() => jump(step - 1)}>上一步</button>
              <button className="text-button" disabled={!playable} onClick={() => { if (last) setStep(0); setPlaying(!playing); }}>{playing ? '暂停播放' : '播放执行过程'}</button>
              <span>{snapshot ? step + 1 : 0} / {snapshots.length} 步</span>
              <button className="text-button" disabled={!playable || last} onClick={() => jump(step + 1)}>下一步</button>
              <button className="text-button" onClick={() => void fullscreen.toggle('visual')}>退出全屏</button>
            </div>}
          </section>
        </div>

        <div className="playback-bar"><div className="playback-buttons"><button className="icon-button" disabled={!playable || step === 0} onClick={() => jump(0)} aria-label="回到第一步"><SkipBack size={19} /></button><button className="icon-button" disabled={!playable || step === 0} onClick={() => jump(step - 1)} aria-label="上一步"><CaretLeft size={21} /></button><button className="play-button" disabled={!playable} onClick={() => { if (last) setStep(0); setPlaying(!playing); }} aria-label={playing ? '暂停播放' : '播放执行过程'}>{playing ? <Pause size={19} weight="fill" /> : <Play size={19} weight="fill" />}</button><button className="icon-button" disabled={!playable || last} onClick={() => jump(step + 1)} aria-label="下一步"><CaretRight size={21} /></button><button className="icon-button" disabled={!playable || last} onClick={() => jump(snapshots.length - 1)} aria-label="跳到最后一步"><SkipForward size={19} /></button></div><span className="step-counter"><strong>{snapshot ? step + 1 : 0}</strong> / {snapshots.length}<span>步</span></span><input className="timeline" type="range" min="0" max={Math.max(0, snapshots.length - 1)} value={Math.min(step, Math.max(0, snapshots.length - 1))} disabled={!playable} onChange={e => jump(Number(e.target.value))} aria-label="执行时间轴" style={{ '--progress': `${snapshots.length > 1 ? step / (snapshots.length - 1) * 100 : 0}%` } as React.CSSProperties} /><label className="speed-select"><span>速度</span><select value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label="播放速度"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label></div>

         <section className={`console ${consoleOpen ? '' : 'collapsed'}`} aria-label="程序输入输出"><div className="console-header"><div className="console-tabs">{(['output', 'input', 'diagnostics'] as const).map(tab => <button key={tab} className={consoleTab === tab ? 'selected' : ''} onClick={() => { setConsoleTab(tab); setConsoleOpen(true); }}>{tab === 'output' ? <TerminalWindow size={16} /> : tab === 'input' ? <ArrowRight size={16} /> : <WarningCircle size={16} />}{tab === 'output' ? '输出' : tab === 'input' ? '输入' : '诊断'}{tab === 'diagnostics' && (runner.trace?.error || runner.message) && <span className="error-dot" />}</button>)}</div><div className="console-meta">{runner.trace && <span>{runner.trace.status === 'completed' ? `执行结束 · 返回 ${runner.trace.exitCode}` : '执行未完成'}<span className="status-divider">·</span>{runner.trace.duration} ms</span>}<button className="icon-button small" onClick={() => setConsoleOpen(!consoleOpen)} aria-label={consoleOpen ? '收起控制台' : '展开控制台'}><CaretDown className={consoleOpen ? '' : 'flipped'} size={17} /></button></div></div>{consoleOpen && <div className="console-body">{consoleTab === 'output' ? <><div className="console-output-label">{runner.trace ? '完整运行输出（不随回放撤销）' : 'STANDARD OUTPUT'}</div><pre data-testid="program-output">{runner.trace?.output || (runner.running ? '正在执行…' : '运行后，程序输出会显示在这里。')}</pre></> : consoleTab === 'input' ? <><label htmlFor="stdin">运行前输入数据，用空格或换行分隔。</label><textarea id="stdin" value={draft.input} onChange={e => updateDraft({ input: e.target.value })} placeholder="例如：12 8" spellCheck={false} /> </> : <div className={runner.trace?.error || runner.message ? 'diagnostic error' : 'diagnostic'}><WarningCircle size={18} /><div><strong>{runner.message || (runner.trace?.error ? '本次执行遇到了问题' : '暂无诊断')}</strong><pre>{runner.trace?.error ?? '支持的基础 C 代码会在浏览器工作线程内解释执行。可点击底部「支持范围」查看限制。'}</pre>{!stale && runner.trace?.errorLine && Object.hasOwn(files, runner.trace.errorFile ?? 'main.c') && <button className="diagnostic-jump" data-testid="jump-to-error" onClick={jumpToError} aria-label={`跳到 ${runner.trace.errorFile ?? 'main.c'} 第 ${runner.trace.errorLine} 行`}><ArrowRight size={14} />跳到 {runner.trace.errorFile ?? 'main.c'} 第 {runner.trace.errorLine} 行</button>}</div></div>}</div>}</section>
      </>}
    </main>

    <footer className="app-footer"><span><span className="status-dot" />代码留在你的浏览器里</span><button onClick={() => setInfo(true)}><Info size={14} />教学执行器 · 支持范围</button><button onClick={() => setShortcuts(true)} aria-keyshortcuts="?">快捷键 <kbd>?</kbd></button></footer>
    {shortcuts && <ShortcutHelp onClose={() => setShortcuts(false)} />}

    {drawer && <div className="overlay" onClick={() => setDrawer(false)}><aside className="course-drawer" role="dialog" aria-modal="true" aria-label="课程目录" onClick={e => e.stopPropagation()}><div className="drawer-header"><div><h2>从 C 基础到模块设计</h2><p>{lessons.length} 个实验，把概念变成直觉。</p></div><button className="icon-button" autoFocus onClick={() => setDrawer(false)} aria-label="关闭课程目录"><X size={22} /></button></div><div className="course-progress"><span>学习进度</span><strong>{completed.length} / {lessons.length}</strong><div><i style={{ width: `${completed.length / lessons.length * 100}%` }} /></div></div><div className="course-list">{groups.map(group => <section key={group}><h3>{group}</h3>{lessons.filter(l => l.group === group).map(item => <button key={item.id} className={`course-item ${item.id === lessonId ? 'selected' : ''}`} onClick={() => selectLesson(item)}><span className="course-index">{completed.includes(item.id) ? <CheckCircle size={19} weight="fill" /> : item.number}</span><span><strong>{item.title}</strong><small>{item.time}</small></span><CaretRight size={15} /></button>)}</section>)}</div><div className="drawer-bottom"><Lightbulb size={18} /><p>不着急记住所有语法。<br />先看清每一步为什么发生。</p></div></aside></div>}

    {settings && <div className="settings-popover"><div className="popover-heading"><strong>学习设置</strong><button className="icon-button small" onClick={() => setSettings(false)} aria-label="关闭设置"><X /></button></div><label><span>减少动画<span>保留状态变化，关闭过渡效果</span></span><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} /></label><label><span>投屏模式<span>放大代码与关键数值</span></span><input type="checkbox" checked={large} onChange={e => setLarge(e.target.checked)} /></label><p>源码与输入自动保存在当前浏览器。重要代码可随时导出。</p></div>}

    {classroomOpen && <div className="settings-popover classroom-popover" role="dialog" aria-label="课堂同步">
      <div className="popover-heading"><strong>课堂同步</strong><button className="icon-button small" onClick={() => setClassroomOpen(false)} aria-label="关闭课堂同步"><X /></button></div>
      {classroom.role === 'off' && <>
        <p>老师开始共享后，学生的屏幕会跟随课程、全部源码与播放步骤，保持只读。</p>
        <button className="run-button" data-testid="start-share" onClick={() => { const room = classroom.startHost(); setNotice(`已开始共享，课堂码 ${room}。`); }}><Broadcast size={16} />开始共享</button>
        <div className="classroom-join">
          <label htmlFor="join-code">加入课堂</label>
          <input id="join-code" value={joinCode} onChange={e => setJoinCode(normalizeRoom(e.target.value))} placeholder="6 位课堂码" aria-label="课堂码" />
          <button className="text-button" disabled={!ROOM_PATTERN.test(joinCode)} onClick={async () => {
            const info = await fetch(`/api/room?room=${joinCode}`).then(response => response.json()).catch(() => null);
            if (!info?.exists) { setNotice('没有找到这个课堂，请确认课堂码，或等老师开始共享。'); return; }
            setClassroomOpen(false);
            enterClassroom(joinCode);
          }}>加入</button>
        </div>
        <p>课堂同步需要页面由课堂服务打开（npm run serve）；离线版没有这个入口。</p>
      </>}
      {classroom.role === 'host' && <>
        <div className="classroom-room"><span>课堂码</span><strong data-testid="room-code">{classroom.room}</strong></div>
        <div className="classroom-join-link">
          <span>学生打开这个链接：</span>
          <code data-testid="join-link">{shareLinks[0]}</code>
          <button className="text-button" onClick={() => {
            const link = shareLinks[0] ?? joinUrl(location.href, classroom.room);
            navigator.clipboard?.writeText(link).then(() => setNotice('课堂链接已复制。'), () => setNotice('复制失败，请手动选择链接。'));
          }}>复制链接</button>
          {shareLinks.length > 1 && <small>打不开时也可以试：{shareLinks.slice(1).join('　')}</small>}
        </div>
        <p data-testid="viewers">{classroom.viewers > 0 ? `${classroom.viewers} 位学生正在跟随` : '还没有学生加入'}{classroom.status === 'error' ? ' · 共享连接中断' : ''}</p>
        {classroom.error && <p role="alert">{classroom.error}</p>}
        <button className="text-button" onClick={() => classroom.leave(setNotice)}>停止共享</button>
      </>}
      {classroom.role === 'viewer' && <>
        <p>正在跟随课堂 <strong>{classroom.room}</strong>，页面只读。</p>
        <p>{classroom.status === 'live' ? '已连接' : classroom.status === 'error' ? '连接中断，正在自动重试…' : '正在连接…'}</p>
        <p>加入前的本机代码已备份，退出跟随后自动恢复。</p>
        {classroom.error && <p role="alert">{classroom.error}</p>}
        <button className="text-button" onClick={leaveClassroom}>退出跟随</button>
      </>}
    </div>}

    {info && <div className="overlay centered" onClick={() => setInfo(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="capability-title" onClick={e => e.stopPropagation()}>
      <div className="modal-header"><h2 id="capability-title">这一版，可以学什么？</h2><button className="icon-button" autoFocus onClick={() => setInfo(false)} aria-label="关闭支持范围"><X size={22} /></button></div>
      <p>代码由 <strong>tree-sitter-c</strong>（WASM，MIT）解析，由逐步求值器在 Web Worker 中真实执行。</p>
      <div className="capability-list"><h3><CheckCircle size={19} />已经验证</h3><p>基础 C 控制流、函数与递归、数组、字符串、指针、结构体、联合体、枚举、typedef、函数指针与回调、静态局部变量、位运算、bool、常用定宽整数、malloc/calloc/free、连续 scanf 与有宽度限制的字符串输入，以及 strcat / strncpy / strchr / strstr / memcpy / memmove / memset / memcmp、sprintf / snprintf、atoi / atof、rand / srand、qsort 与 sqrt / pow / fabs 等 math 函数。</p><p><strong>宏与预处理</strong>：对象宏、函数式宏、续行、# 字符串化、## 拼接、可变参数宏、#undef、#if / #elif / #else、defined、头文件保护、#pragma once、#error、__LINE__ / __FILE__。可查看预处理结果，回放对应原始源码位置。</p><p><strong>多文件模块</strong>：独立解析 .c，链接跨文件函数与 extern 对象，文件级 static 隔离。共 27 节课程（含递归、二维数组、链表、联合体），最终章是可运行的学生成绩管理系统。编辑区与可视化区支持浏览器级真全屏。</p><h3><Clock size={19} />教学子集边界</h3><p>项目最多 24 个平级 .c/.h 文件，源码合计 32,000 字符；入口文件名保留为 main.c。尚不支持 #line、GNU 专用宏扩展、子目录、完整构建系统、位域、变长数组、线程及完整文件 I/O。标准库是教学子集，并非完整 C17 编译器；整数执行仍受 JavaScript 安全整数范围约束。</p></div>
      <p>{runner.trace?.platform?.label ?? 'x86-64 教学模型'}：字段偏移、sizeof 与指针宽度按此模型计算。指针箭头是逻辑关系，数组游标是索引指示。</p>
      <p>高亮对应本次停点，同一行可能产生多个状态。模块包含关系来自源码，调用层来自实际执行。暂停和回退控制已有轨迹，输出窗口保留完整运行输出。未定义行为不会被自动检测。</p>
      <a href="https://github.com/tree-sitter/tree-sitter-c" target="_blank" rel="noreferrer">查看解析器 <ArrowRight size={15} /></a>
    </section></div>}

    {resetConfirm && <div className="overlay centered" onClick={() => setResetConfirm(false)}><section className="modal compact" role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={e => e.stopPropagation()}><h2 id="reset-title">恢复本课示例？</h2><p>这会替换本课的全部文件和输入。需要保留的代码请先导出。</p><div className="modal-actions"><button className="text-button" autoFocus onClick={() => setResetConfirm(false)}>保留修改</button><button className="run-button" onClick={() => { updateDraft({ code: lesson.code, files: lesson.files, input: lesson.input }); setActiveFile('main.c'); runner.reset(); setStep(0); setResetConfirm(false); setNotice('已恢复本课示例。'); }}>恢复示例</button></div></section></div>}
    {notice && <div className="toast" role="status"><Info size={18} />{notice}</div>}
  </div>;
}
