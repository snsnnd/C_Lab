import { CSourceError, type Program, type Declaration } from './c/parse';
import { typeName, type Type } from './c/types';
import { preprocess } from './c/preprocess';

export type SourceFiles = Record<string, string>;
export interface SourceLocation { file: string; line: number }
export interface PreparedUnit { file: string; source: string; locations: SourceLocation[] }

export function validateFiles(files: SourceFiles): void {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('项目格式错误：缺少 files 文件映射。');
  const names = Object.keys(files);
  if (!names.length || names.length > 24) throw new Error('项目需要 1–24 个源码文件。');
  if (!names.some(name => name.endsWith('.c'))) throw new Error('项目至少需要一个 .c 文件。');
  for (const name of names) {
    if (!/^[a-zA-Z0-9_-]+\.(c|h)$/.test(name) || typeof files[name] !== 'string') throw new Error(`无效文件名：${name}；请使用英文字母、数字、下划线或短横线及 .c/.h 后缀。`);
  }
  if (Object.values(files).reduce((sum, text) => sum + text.length, 0) > 32000) throw new Error('项目源码合计不能超过 32,000 字符。');
}

/** Each translation unit gets its own preprocessor macro environment. */
export function prepareProject(files: SourceFiles): PreparedUnit[] {
  validateFiles(files);
  return Object.keys(files).filter(name => name.endsWith('.c')).map(file => ({ file, ...preprocess(files, file) }));
}

/** Assign unique internal line IDs without merging parser/type scopes across units. */
export function offsetLines(program: Program, offset: number): void {
  const seen = new WeakSet<object>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.line === 'number') record.line += offset;
    Object.values(record).forEach(visit);
  };
  visit(program);
}

export function linkPrograms(units: { file: string; program: Program }[]): Program {
  const merged: Program = { decls: [], tags: [], units: new Map() };
  const symbols = new Map<string, Declaration>();
  const definitions = new Map<string, Declaration>();
  for (const { file, program } of units) {
    merged.tags.push(...program.tags);
    for (const decl of program.decls) {
      merged.units!.set(decl, file);
      merged.decls.push(decl);
      if (decl.kind === 'TypeDecl') continue;
      const key = decl.storage === 'static' ? `${file}:${decl.name}` : decl.name;
      const prior = symbols.get(key);
      if (prior && (prior.kind !== decl.kind || !compatible(prior.type, decl.type))) throw new CSourceError(`链接失败：${decl.name} 的声明类型不一致。`, decl.line);
      symbols.set(key, decl);
      const defined = decl.kind === 'FuncDecl' ? !!decl.body : decl.storage !== 'extern' || !!decl.init;
      if (!defined) continue;
      const previous = definitions.get(key);
      if (previous) {
        // Multiple tentative definitions in one translation unit denote one object.
        if (decl.kind === 'VarDecl' && previous.kind === 'VarDecl' && merged.units!.get(previous) === file && (!decl.init || !previous.init)) {
          if (decl.init) definitions.set(key, decl);
          continue;
        }
        throw new CSourceError(`链接失败：${decl.name} 重复定义（${file}）。`, decl.line);
      }
      definitions.set(key, decl);
    }
  }
  for (const [key, decl] of symbols) {
    if (!definitions.has(key) && decl.kind === 'VarDecl') throw new CSourceError(`链接失败：extern 变量 ${decl.name} 没有定义。`, decl.line);
  }
  // Retain prototypes for each unit's visibility; allocate each global just once.
  merged.decls = merged.decls.filter(decl => decl.kind !== 'VarDecl' || decl.storage === 'extern' && !decl.init || definitions.get(decl.storage === 'static' ? `${merged.units!.get(decl)}:${decl.name}` : decl.name) === decl);
  return merged;
}

function compatible(a: Type, b: Type, seen = new Map<Type, Type>()): boolean {
  if (seen.get(a) === b) return true;
  if (a.kind !== b.kind) return false;
  seen.set(a, b);
  if (a.kind === 'record' && b.kind === 'record') {
    if (a.name !== b.name || a.tag !== b.tag) return false;
    if (!a.complete || !b.complete) return true;
    return a.fields.length === b.fields.length && a.fields.every((field, i) => field.name === b.fields[i].name && compatible(field.type, b.fields[i].type, seen));
  }
  if (a.kind === 'pointer' && b.kind === 'pointer') return compatible(a.to, b.to, seen);
  if (a.kind === 'array' && b.kind === 'array') return a.count === b.count && compatible(a.of, b.of, seen);
  if (a.kind === 'function' && b.kind === 'function') return a.variadic === b.variadic && compatible(a.ret, b.ret, seen) && a.params.length === b.params.length && a.params.every((p, i) => compatible(p.type, b.params[i].type, seen));
  return typeName(a) === typeName(b);
}
