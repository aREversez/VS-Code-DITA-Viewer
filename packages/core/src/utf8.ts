// Small byte helpers that stand in for Buffer, so core runs where there is none.

/**
 * UTF-8 length of a string in bytes, equal to Buffer.byteLength(s, 'utf8'):
 * a lone surrogate counts as 3, the bytes of its U+FFFD replacement.
 */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
