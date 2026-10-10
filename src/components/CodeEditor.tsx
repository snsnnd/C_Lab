import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { bracketMatching, foldGutter, indentOnInput, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { tags } from '@lezer/highlight';
import { Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';

// Highlight the interpreter's current stop. A line may hold several stops.
const currentLine = StateEffect.define<number>();
const errorLine = StateEffect.define<number>();
const highlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects) {
      if (!effect.is(currentLine)) continue;
      const { doc } = transaction.state;
      value = effect.value > 0 && effect.value <= doc.lines
        ? Decoration.set([Decoration.line({ class: 'cm-execution-line' }).range(doc.line(effect.value).from)])
        : Decoration.none;
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});
const errorHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects) {
      if (!effect.is(errorLine)) continue;
      const { doc } = transaction.state;
      value = effect.value > 0 && effect.value <= doc.lines
        ? Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(doc.line(effect.value).from)])
        : Decoration.none;
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

const lightHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: 'var(--code-keyword)' },
  { tag: [tags.name, tags.character, tags.macroName], color: 'var(--code-name)' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--code-name)' },
  { tag: [tags.definition(tags.name), tags.propertyName], color: 'var(--code-name)' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name), tags.number, tags.typeName, tags.className, tags.bool, tags.null, tags.self, tags.namespace], color: 'var(--code-const)' },
  { tag: [tags.operator, tags.operatorKeyword, tags.punctuation, tags.separator, tags.bracket, tags.angleBracket], color: 'var(--code-punct)' },
  { tag: [tags.comment, tags.meta, tags.docComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-string)' },
  { tag: tags.invalid, color: 'var(--red)' },
]);

export function CodeEditor({ value, onChange, line, errorLine: invalidLine, dark, large, readOnly = false }: {
  value: string; onChange(value: string): void; line: number; errorLine?: number; dark: boolean; large: boolean; readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Set only while this component writes `value` back into the document, so that
  // echo does not re-enter onChange and loop through React state updates.
  const syncing = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    const view_ = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), foldGutter(), drawSelection(), history(), indentOnInput(), bracketMatching(),
          highlightActiveLine(), highlightActiveLineGutter(),
          cpp(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          highlight,
          errorHighlight,
          EditorView.lineWrapping,
          EditorView.updateListener.of(update => {
            if (update.docChanged && !syncing.current) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height: '100%', backgroundColor: 'var(--surface)' },
            '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: large ? '22px' : '16px', lineHeight: '1.75' },
            '.cm-content': { padding: '16px 0 40px', caretColor: 'var(--ink)' },
            // CodeMirror's base theme draws the caret black; follow the theme ink
            // so it stays white on the dark background.
            '.cm-cursor': { borderLeftColor: 'var(--ink)' },
            '.cm-line': { paddingLeft: '10px' },
            '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--muted)', border: 'none', minWidth: '42px' },
            '.cm-activeLine': { backgroundColor: 'transparent' },
            '&.cm-focused': { outline: 'none' },
            '.cm-selectionBackground': { backgroundColor: 'var(--blue-fill) !important' },
          }),
          EditorView.theme({ '.cm-execution-line': { backgroundColor: 'var(--blue-fill)', boxShadow: 'inset 3px 0 var(--accent)' } }),
...(dark ? [syntaxHighlighting(oneDarkHighlightStyle)] : [syntaxHighlighting(lightHighlightStyle)]),
        ],
      }),
    });
    view.current = view_;
    view_.dispatch({ effects: currentLine.of(line) });
    view_.dispatch({ effects: errorLine.of(invalidLine ?? 0) });
    return () => { view_.destroy(); view.current = null; };
  // The editor is recreated on theme or read-only changes; other prop changes are applied below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, large, readOnly]);

  useEffect(() => {
    const view_ = view.current;
    if (view_ && view_.state.doc.toString() !== value) {
      syncing.current = true;
      try {
        view_.dispatch({ changes: { from: 0, to: view_.state.doc.length, insert: value } });
      } finally {
        syncing.current = false;
      }
    }
  }, [value]);

  useEffect(() => {
    const view_ = view.current;
    if (!view_) return;
    view_.dispatch({ effects: currentLine.of(line) });
    view_.dispatch({ effects: errorLine.of(invalidLine ?? 0) });
    if (line > 0 && line <= view_.state.doc.lines) {
      view_.dispatch({ effects: EditorView.scrollIntoView(view_.state.doc.line(line).from, { y: 'nearest' }) });
    }
  }, [line, value, invalidLine]);

  return <div ref={host} className="editor-host" aria-label="C 代码编辑器" role="group" />;
}
