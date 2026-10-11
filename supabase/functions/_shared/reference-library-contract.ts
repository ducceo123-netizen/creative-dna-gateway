/** Shared, public-safe validation. References are optional inspiration, never policy. */
export const REFERENCE_LIBRARY_SCHEMA = 'uid-reference-library/1';
export const MAX_LIBRARY_IMAGE_BYTES = 5 * 1024 * 1024;
export const LIBRARY_PAGE_SIZE = 20;
export const LIBRARY_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type LibraryMime = typeof LIBRARY_IMAGE_TYPES[number];
export const libraryId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
export type LibraryNotes = { filename: string; case_title: string; brand: string; material: string; caption: string; why_good: string };
export type LibraryRecord = LibraryNotes & { id: string; mime_type: LibraryMime; sha256: string; byte_length: number; width: number; height: number; created_at: string };
export type LibraryPage = { schema: typeof REFERENCE_LIBRARY_SCHEMA; references: LibraryRecord[]; can_upload: boolean; next_offset: number | null };
const limits: Record<keyof LibraryNotes, number> = { filename: 120, case_title: 120, brand: 80, material: 80, caption: 160, why_good: 500 };
export function sanitizeLibraryNotes(value: unknown): LibraryNotes {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !Object.hasOwn(limits, k))) throw new Error('INVALID_REFERENCE_NOTES');
  const result = {} as LibraryNotes;
  for (const key of Object.keys(limits) as (keyof LibraryNotes)[]) {
    const item = (value as any)[key] ?? '';
    if (typeof item !== 'string' || item.length > limits[key] * 2) throw new Error('INVALID_REFERENCE_NOTES');
    result[key] = item.normalize('NFC').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, limits[key]);
  }
  result.filename = result.filename.replace(/[/\\]/g, '_').replace(/^\.+/, '') || 'reference';
  return result;
}
export function encodeLibraryNotes(value: LibraryNotes): string { return encodeURIComponent(JSON.stringify(sanitizeLibraryNotes(value))); }
export function decodeLibraryNotes(value: string | null): LibraryNotes {
  if (!value || value.length > 12000) throw new Error('INVALID_REFERENCE_NOTES');
  return sanitizeLibraryNotes(JSON.parse(decodeURIComponent(value)));
}
export function parseLibraryRecord(value: any): LibraryRecord {
  if (!value || !libraryId(value.id) || !LIBRARY_IMAGE_TYPES.includes(value.mime_type) || !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isInteger(value.byte_length) || value.byte_length < 1 || value.byte_length > MAX_LIBRARY_IMAGE_BYTES ||
    !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 12000 || value.height > 12000 || value.width * value.height > 40000000 ||
    typeof value.created_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.created_at) || !Number.isFinite(Date.parse(value.created_at))) throw new Error('INVALID_LIBRARY_RECORD');
  const notes = sanitizeLibraryNotes(Object.fromEntries(Object.keys(limits).map(k => [k, value[k]])));
  return { ...notes, id: value.id, mime_type: value.mime_type, sha256: value.sha256, byte_length: value.byte_length, width: value.width, height: value.height, created_at: value.created_at };
}
export function parseLibraryPage(value: any): LibraryPage {
  if (value?.schema !== REFERENCE_LIBRARY_SCHEMA || typeof value.can_upload !== 'boolean' || !Array.isArray(value.references) || value.references.length > LIBRARY_PAGE_SIZE ||
    (value.next_offset !== null && (!Number.isSafeInteger(value.next_offset) || value.next_offset < 0 || value.next_offset > 1000000))) throw new Error('INVALID_LIBRARY_PAGE');
  const references = value.references.map(parseLibraryRecord);
  if (new Set(references.map((r: LibraryRecord) => r.id)).size !== references.length) throw new Error('DUPLICATE_LIBRARY_REFERENCE');
  return { schema: REFERENCE_LIBRARY_SCHEMA, references, can_upload: value.can_upload, next_offset: value.next_offset };
}
/** Bounded raster structure validation, not full decompression. The UI also decodes locally. */
export function inspectLibraryImage(bytes: Uint8Array, mime: string): { width: number; height: number } {
  const invalid = () => { throw new Error('INVALID_REFERENCE_IMAGE'); };
  if (!LIBRARY_IMAGE_TYPES.includes(mime as LibraryMime) || !bytes.length || bytes.length > MAX_LIBRARY_IMAGE_BYTES) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  const dimensions = (width: number, height: number) => { if (!width || !height || width > 12000 || height > 12000 || width * height > 40000000) throw new Error('REFERENCE_DIMENSIONS_EXCEEDED'); };
  let width = 0, height = 0;
  if (mime === 'image/png') {
    if (bytes.length < 45 || [...bytes.subarray(0, 8)].join(',') !== '137,80,78,71,13,10,26,10' || view.getUint32(8) !== 13 || ascii(12,4) !== 'IHDR') invalid();
    width = view.getUint32(16); height = view.getUint32(20); dimensions(width,height);
    const depths: Record<number,number[]> = {0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
    if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) invalid();
    const table = new Uint32Array(256);
    for (let i=0;i<256;i++) { let c=i; for(let j=0;j<8;j++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; table[i]=c; }
    let offset=8, imageData=false, ended=false, palette=false, idatEnded=false, count=0;
    while (offset+12<=bytes.length) {
      if (++count>4096) invalid();
      const length=view.getUint32(offset), kind=ascii(offset+4,4);
      if (length>bytes.length-offset-12 || !/^[A-Za-z]{4}$/.test(kind)) invalid();
      let crc=0xffffffff; for(let i=offset+4;i<offset+8+length;i++) crc=table[(crc^bytes[i])&255]^(crc>>>8);
      if (((crc^0xffffffff)>>>0)!==view.getUint32(offset+8+length)) invalid();
      if ((kind==='IHDR' && offset!==8) || ['acTL','fcTL','fdAT'].includes(kind)) invalid();
      if (kind==='PLTE') { if(imageData || palette || !length || length>768 || length%3) invalid(); palette=true; }
      if (kind==='IDAT') { if(idatEnded || (bytes[25]===3 && !palette)) invalid(); imageData ||= length>0; }
      else if(imageData) idatEnded=true;
      if (kind[0]===kind[0].toUpperCase() && !['IHDR','PLTE','IDAT','IEND'].includes(kind)) invalid();
      offset+=length+12;
      if(kind==='IEND') { ended=length===0 && offset===bytes.length; break; }
    }
    if(!imageData || !ended) invalid();
  } else if (mime === 'image/jpeg') {
    if(bytes.length<32 || bytes[0]!==255 || bytes[1]!==216) invalid();
    let offset=2, scans=0, quantization=false, huffman=false, frame=false, ended=false;
    const components=new Set<number>();
    while(offset<bytes.length) {
      if(bytes[offset++]!==255) invalid();
      while(bytes[offset]===255) offset++;
      const marker=bytes[offset++];
      if(marker===0xd9) { ended=offset===bytes.length; break; }
      if(offset+2>bytes.length || marker===0xd8 || marker===0 || (marker>=0xd0 && marker<=0xd7)) invalid();
      const length=view.getUint16(offset), end=offset+length;
      if(length<2 || end>bytes.length) invalid();
      if([0xc0,0xc1,0xc2].includes(marker)) {
        if(frame || length<11 || bytes[offset+2]!==8) invalid();
        const count=bytes[offset+7]; if(![1,3,4].includes(count) || length!==8+3*count) invalid();
        height=view.getUint16(offset+3); width=view.getUint16(offset+5); dimensions(width,height);
        for(let i=0;i<count;i++) { const at=offset+8+i*3, sampling=bytes[at+1]; if(components.has(bytes[at]) || !(sampling>>4) || (sampling>>4)>4 || !(sampling&15) || (sampling&15)>4 || bytes[at+2]>3) invalid(); components.add(bytes[at]); }
        frame=true;
      } else if(marker===0xdb) {
        let at=offset+2; while(at<end) { const spec=bytes[at++], precision=spec>>4; if(precision>1 || (spec&15)>3) invalid(); at+=64*(precision+1); }
        if(at!==end || length<67) invalid(); quantization=true;
      } else if(marker===0xc4) {
        let at=offset+2; while(at<end) { if(at+17>end) invalid(); const spec=bytes[at++]; if((spec>>4)>1 || (spec&15)>3) invalid(); let symbols=0; for(let i=0;i<16;i++) symbols+=bytes[at++]; if(!symbols || symbols>256) invalid(); at+=symbols; }
        if(at!==end || length<20) invalid(); huffman=true;
      } else if(marker===0xda) {
        const count=bytes[offset+2]; if(!frame || !quantization || !huffman || !count || count>components.size || length!==6+2*count) invalid();
        const seen=new Set<number>();
        for(let i=0;i<count;i++) { const at=offset+3+i*2, selector=bytes[at+1]; if(!components.has(bytes[at]) || seen.has(bytes[at]) || (selector>>4)>3 || (selector&15)>3) invalid(); seen.add(bytes[at]); }
        offset=end; let entropy=0;
        while(offset<bytes.length) {
          if(bytes[offset]!==255) { offset++; entropy++; continue; }
          const next=bytes[offset+1];
          if(next===0) { offset+=2; entropy++; continue; }
          if(next>=0xd0 && next<=0xd7) { offset+=2; continue; }
          break;
        }
        if(!entropy) invalid(); scans++; continue;
      } else if(marker===0xdd) { if(length!==4) invalid(); }
      else if(!((marker>=0xe0 && marker<=0xef) || marker===0xfe)) invalid();
      offset=end;
    }
    if(!ended || !scans || !frame) invalid();
  } else {
    if(bytes.length<30 || ascii(0,4)!=='RIFF' || ascii(8,4)!=='WEBP' || view.getUint32(4,true)+8!==bytes.length) invalid();
    let offset=12, frames=0, canvas=false, frameWidth=0,frameHeight=0;
    while(offset+8<=bytes.length) {
      const kind=ascii(offset,4),size=view.getUint32(offset+4,true),start=offset+8;
      if(size>bytes.length-start) invalid();
      if(kind==='VP8X') {
        if(canvas || offset!==12 || size!==10 || (bytes[start]&0xc3) || bytes[start+1] || bytes[start+2] || bytes[start+3]) invalid();
        canvas=true; width=1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16); height=1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16); dimensions(width,height);
      } else if(kind==='VP8 ') {
        if(size<=10 || (bytes[start]&1) || ascii(start+3,3)!=='\x9d\x01\x2a') invalid();
        frames++; frameWidth=view.getUint16(start+6,true)&0x3fff;frameHeight=view.getUint16(start+8,true)&0x3fff;dimensions(frameWidth,frameHeight);
      } else if(kind==='VP8L') {
        if(size<=5 || bytes[start]!==0x2f) invalid(); const bits=view.getUint32(start+1,true); if(bits>>>29) invalid();
        frames++; frameWidth=(bits&0x3fff)+1;frameHeight=((bits>>>14)&0x3fff)+1;dimensions(frameWidth,frameHeight);
      } else if(!['ALPH','ICCP','EXIF','XMP '].includes(kind)) invalid();
      offset=start+size+(size%2);
      if(size%2 && bytes[offset-1]!==0) invalid();
    }
    if(frames!==1 || offset!==bytes.length || (canvas && (width!==frameWidth || height!==frameHeight))) invalid();
    if(!canvas) { width=frameWidth;height=frameHeight; }
  }
  dimensions(width,height); return {width,height};
}
