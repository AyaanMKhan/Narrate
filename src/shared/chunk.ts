import { MAX_CHUNK_CHARS } from './constants';
import type { Chunk } from './types';

/**
 * Split text into sentence-ish chunks, tracking offsets into the original
 * string so the UI can highlight exactly what is being spoken.
 * Long sentences are split further on clause boundaries, then hard-wrapped.
 */
export function chunkText(input: string): Chunk[] {
  const text = input.replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const chunks: Chunk[] = [];
  let cursor = 0;

  const pieces = splitSentences(text);
  for (const piece of pieces) {
    const start = text.indexOf(piece, cursor);
    const at = start === -1 ? cursor : start;
    for (const part of hardWrap(piece)) {
      const partStart = text.indexOf(part, at);
      const s = partStart === -1 ? at : partStart;
      chunks.push({ index: chunks.length, text: part, start: s, end: s + part.length });
    }
    cursor = at + piece.length;
  }
  return chunks;
}

function splitSentences(text: string): string[] {
  // Split after . ! ? … (and CJK 。！？) when followed by whitespace.
  return text
    .split(/(?<=[.!?…。！？])\s+(?=[^\s])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hardWrap(sentence: string): string[] {
  if (sentence.length <= MAX_CHUNK_CHARS) return [sentence];

  const out: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_CHUNK_CHARS) {
    const window = rest.slice(0, MAX_CHUNK_CHARS);
    // Prefer a clause break, then any space, then a hard cut.
    const cut =
      Math.max(window.lastIndexOf('; '), window.lastIndexOf(', '), window.lastIndexOf(' — ')) + 1 ||
      window.lastIndexOf(' ') ||
      MAX_CHUNK_CHARS;
    const idx = cut > 40 ? cut : MAX_CHUNK_CHARS;
    out.push(rest.slice(0, idx).trim());
    rest = rest.slice(idx).trim();
  }
  if (rest) out.push(rest);
  return out;
}
