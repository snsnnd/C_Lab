import { CSourceError } from './parse';

/** Replace comments with whitespace without changing offsets or source line numbers. */
export function maskComments(source: string): string {
  const chars = source.split('');
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === '"' || char === "'") {
      const quote = char;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i++] === quote) break;
      }
      continue;
    }
    const lineComment = source.startsWith('//', i);
    const blockComment = source.startsWith('/*', i);
    if (!lineComment && !blockComment) { i++; continue; }
    const start = i;
    if (blockComment) {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new CSourceError('块注释未闭合，请补上 */。', source.slice(0, start).split('\n').length);
      i = end + 2;
    } else {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
    }
    for (let j = start; j < i; j++) {
      if (source[j] !== '\n' && source[j] !== '\r') chars[j] = ' ';
    }
  }
  return chars.join('');
}
