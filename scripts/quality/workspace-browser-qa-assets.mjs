/** Portable deterministic synthetic PNGs. No Python, fonts, native dependency,
 * real product, provider or network. Geometry is test data, not AI artwork. */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QA_SLOTS = ['banner_desktop', 'banner_mobile', 'detail_01', 'detail_02', 'detail_03', 'detail_main', 'gtk_01', 'gtk_02', 'gtk_03', 'occasion_icon_01', 'occasion_icon_02', 'occasion_icon_03', 'occasion_icon_04', 'occasion_01', 'occasion_02', 'wyl_01', 'wyl_02', 'wyl_03'];
const glyphs = Object.fromEntries(Object.entries({
  A:'01110 10001 10001 11111 10001 10001 10001', B:'11110 10001 10001 11110 10001 10001 11110', C:'01111 10000 10000 10000 10000 10000 01111', D:'11110 10001 10001 10001 10001 10001 11110',
  E:'11111 10000 10000 11110 10000 10000 11111', F:'11111 10000 10000 11110 10000 10000 10000', G:'01111 10000 10000 10111 10001 10001 01111', H:'10001 10001 10001 11111 10001 10001 10001',
  I:'11111 00100 00100 00100 00100 00100 11111', J:'00111 00010 00010 00010 10010 10010 01100', K:'10001 10010 10100 11000 10100 10010 10001', L:'10000 10000 10000 10000 10000 10000 11111',
  M:'10001 11011 10101 10101 10001 10001 10001', N:'10001 11001 11001 10101 10011 10011 10001', O:'01110 10001 10001 10001 10001 10001 01110', P:'11110 10001 10001 11110 10000 10000 10000',
  Q:'01110 10001 10001 10001 10101 10010 01101', R:'11110 10001 10001 11110 10100 10010 10001', S:'01111 10000 10000 01110 00001 00001 11110', T:'11111 00100 00100 00100 00100 00100 00100',
  U:'10001 10001 10001 10001 10001 10001 01110', V:'10001 10001 10001 10001 10001 01010 00100', W:'10001 10001 10001 10101 10101 10101 01010', X:'10001 10001 01010 00100 01010 10001 10001',
  Y:'10001 10001 01010 00100 00100 00100 00100', Z:'11111 00001 00010 00100 01000 10000 11111',
  0:'01110 10001 10011 10101 11001 10001 01110', 1:'00100 01100 00100 00100 00100 00100 01110', 2:'01110 10001 00001 00010 00100 01000 11111', 3:'11110 00001 00001 01110 00001 00001 11110',
  4:'00010 00110 01010 10010 11111 00010 00010', 5:'11111 10000 10000 11110 00001 00001 11110', 6:'01110 10000 10000 11110 10001 10001 01110', 7:'11111 00001 00010 00100 01000 01000 01000', 8:'01110 10001 10001 01110 10001 10001 01110', 9:'01110 10001 10001 01111 00001 00001 01110',
  '/':'00001 00001 00010 00100 01000 10000 10000', '-':'00000 00000 00000 11111 00000 00000 00000', '|':'00100 00100 00100 00100 00100 00100 00100', ' ':'00000 00000 00000 00000 00000 00000 00000',
}).map(([key, value]) => [key, value.split(' ')]));
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); name.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([name, data])), out.length - 4); return out; }
export function createQaPng(slot, revision) {
  if (!QA_SLOTS.includes(slot) || !['current', 'before'].includes(revision)) throw new Error('INVALID_SYNTHETIC_FIXTURE');
  const width = slot === 'banner_desktop' ? 1280 : 640, height = slot === 'banner_desktop' ? 600 : slot === 'banner_mobile' ? 760 : 640;
  const background = revision === 'current' ? [242,237,226] : [230,235,241], accent = revision === 'current' ? [45,102,80] : [75,89,126];
  const pixels = Buffer.alloc(width * height * 3);
  for (let p = 0; p < pixels.length; p += 3) { pixels[p] = background[0]; pixels[p+1] = background[1]; pixels[p+2] = background[2]; }
  function rect(x, y, w, h, color) { for (let row = Math.max(0, Math.floor(y)); row < Math.min(height, y+h); row++) for (let col = Math.max(0, Math.floor(x)); col < Math.min(width, x+w); col++) { const p = (row * width + col) * 3; pixels[p] = color[0]; pixels[p+1] = color[1]; pixels[p+2] = color[2]; } }
  function text(value, y, scale) { const x = Math.floor((width - (value.length * 6 - 1) * scale) / 2); [...value].forEach((letter, i) => { const glyph = glyphs[letter]; if (!glyph) throw new Error('UNKNOWN_FIXTURE_GLYPH'); glyph.forEach((row, dy) => [...row].forEach((bit, dx) => { if (bit === '1') rect(x+(i*6+dx)*scale, y+dy*scale, scale, scale, accent); })); }); }
  const radius = Math.floor(Math.min(width, height) / 4), x = width/2-radius, y = height/2-radius;
  rect(x-22, y-22, radius*2+44, radius*2+44, [255,255,255]); rect(x, y, radius*2, radius*2, accent);
  rect(x+24, height/2-2, radius*2-48, 5, [255,255,255]); rect(width/2-2, y+24, 5, radius*2-48, [255,255,255]);
  text('SYNTHETIC QA / NOT A PRODUCT', 28, 3); text(slot.replaceAll('_', ' ').toUpperCase(), height-90, 3); text(revision.toUpperCase()+' | LOCAL UI TEST ONLY', height-42, 2);
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8] = 8; header[9] = 2;
  const scanlines = Buffer.alloc((width*3+1)*height); for (let row = 0; row < height; row++) pixels.copy(scanlines, row*(width*3+1)+1, row*width*3, (row+1)*width*3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',header), chunk('IDAT',deflateSync(scanlines,{level:9})), chunk('IEND',Buffer.alloc(0))]);
}
export async function writeQaFixtures(directory) { await mkdir(directory,{recursive:true}); for (const revision of ['before','current']) for (const slot of QA_SLOTS) await writeFile(resolve(directory, `${revision}-${slot}.png`),createQaPng(slot,revision)); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { if (process.argv.length !== 3) throw new Error('Usage: node workspace-browser-qa-assets.mjs OUTPUT_DIRECTORY'); await writeQaFixtures(resolve(process.argv[2])); }
