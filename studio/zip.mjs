// Portable no-dependency ZIP writer (stored entries, no compression).
// Only trusted app-created export filenames are passed; zip slip paths are rejected.
const crcTable=new Uint32Array(256);
for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[i]=c>>>0;}
function crc32(buffer){let c=0xffffffff;for(const b of buffer)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function packZip(entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>24)throw Error('ZIP file count exceeds limit');
 let offset=0,total=0;const local=[],central=[];
 for(const entry of entries){
  const name=String(entry.name||'');
  if(!name||name.length>120||name.startsWith('/')||name.includes('..')||!/^[a-zA-Z0-9_./-]+$/.test(name))throw Error('Unsafe ZIP entry name');
  const body=Buffer.isBuffer(entry.bytes)?entry.bytes:Buffer.from(entry.bytes||'');
  total+=body.length;if(body.length>8*1024*1024||total>64*1024*1024)throw Error('ZIP asset limit exceeded');
  const filename=Buffer.from(name,'utf8'),checksum=crc32(body),header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0800,6);
  header.writeUInt16LE(0,8);header.writeUInt16LE(0,10);header.writeUInt16LE(0,12);
  header.writeUInt32LE(checksum,14);header.writeUInt32LE(body.length,18);header.writeUInt32LE(body.length,22);
  header.writeUInt16LE(filename.length,26);header.writeUInt16LE(0,28);
  local.push(header,filename,body);
  const dir=Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50,0);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(0x0800,8);
  dir.writeUInt16LE(0,10);dir.writeUInt16LE(0,12);dir.writeUInt16LE(0,14);
  dir.writeUInt32LE(checksum,16);dir.writeUInt32LE(body.length,20);dir.writeUInt32LE(body.length,24);
  dir.writeUInt16LE(filename.length,28);dir.writeUInt16LE(0,30);dir.writeUInt16LE(0,32);
  dir.writeUInt16LE(0,34);dir.writeUInt16LE(0,36);dir.writeUInt32LE(0,38);
  dir.writeUInt32LE(offset,42);
  central.push(dir,filename);
  offset+=header.length+filename.length+body.length;
 }
 const centralLen=central.reduce((n,x)=>n+x.length,0);
 const footer=Buffer.alloc(22);
 footer.writeUInt32LE(0x06054b50,0);footer.writeUInt16LE(0,4);footer.writeUInt16LE(0,6);
 footer.writeUInt16LE(entries.length,8);footer.writeUInt16LE(entries.length,10);
 footer.writeUInt32LE(centralLen,12);footer.writeUInt32LE(offset,16);
 footer.writeUInt16LE(0,20);
 return Buffer.concat([...local,...central,footer]);
}
