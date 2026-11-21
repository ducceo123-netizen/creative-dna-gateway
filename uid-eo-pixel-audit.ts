import {createHash} from "node:crypto";
import {inflateSync} from "node:zlib";
import {readBoundedReferenceBytes} from "./supabase/functions/_shared/private-reference-access.ts";
export const EO_PIXEL_AUDIT_VERSION="uid-eo-pixel-audit/2026-11-21.v2";
export const EO_PIXEL_AUDIT_DESCRIPTION="Independent Gateway byte-level image audit: safely fetch actual same-brand/Shopify CDN sources, measure full PNG pixels (dimensions, brightness, contrast, sharp local detail and perceptual duplicates), verify JPEG/WebP dimensions/signatures. Non-PNG sources are explicitly METADATA_ONLY on this pinned no-native-dependency Gateway and must NOT be called pixel-inspected. Does not certify subjective EO beauty, typography or product anatomy.";
export type PixelSource={slot:string;image_url:string};
const brandHosts=new Set(["pawfecthouse.com","www.pawfecthouse.com","giftsoul.co","www.giftsoul.co","soulprise.co","www.soulprise.co"]);
export function trustedEoImageUrl(value:string){
 try{if(typeof value!=="string"||!value.startsWith("https://")||value.length>2000)return false;
  const u=new URL(value),h=u.hostname.toLowerCase();if(u.username||u.password||u.port||u.hash)return false;
  return brandHosts.has(h)||h==="cdn.shopify.com"||h==="cdn.shopifycdn.net"||h==="shopifycdn.net"||h.endsWith(".shopifycdn.net");
 }catch{return false;}
}
export async function fetchEoImage(u:string,fetcher:typeof fetch=fetch){
 if(!trustedEoImageUrl(u))throw new Error("UNTRUSTED_IMAGE_ORIGIN");
 const r=await fetcher(u,{headers:{"Accept":"image/png,image/jpeg,image/webp","User-Agent":"UID-Brands-EO-Pixel-Research/1.0"},
  redirect:"manual",signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error("IMAGE_HTTP_"+r.status);
 const mime=(r.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
 if(!["image/png","image/jpeg","image/webp"].includes(mime))throw new Error("UNSUPPORTED_IMAGE_MIME");
 const bytes=await readBoundedReferenceBytes(r.body,8*1024*1024);
 if(!bytes||bytes.byteLength<32)throw new Error("IMAGE_UNAVAILABLE_OR_OVERSIZED");
 return {bytes:Buffer.from(bytes),mime};
}
const PNG=Buffer.from("89504e470d0a1a0a","hex");
type Decoded={width:number;height:number;rgb:Uint8Array;format:"png"};
export function decodePngBytes(buffer:Buffer):Decoded{
 if(!buffer.subarray(0,8).equals(PNG))throw new Error("INVALID_PNG_SIGNATURE");
 let offset=8,width=0,height=0,bit=0,kind=0,interlace=0,palette:Buffer|undefined,transparency:Buffer|undefined;
 const blocks:Buffer[]=[];let end=false;
 while(offset+12<=buffer.length){
   const len=buffer.readUInt32BE(offset),type=buffer.toString("ascii",offset+4,offset+8);
   if(len>8*1024*1024||offset+12+len>buffer.length)throw new Error("MALFORMED_PNG_CHUNK");
   const data=buffer.subarray(offset+8,offset+8+len);offset+=12+len;
   if(type==="IHDR"){
     if(len!==13)throw new Error("INVALID_PNG_IHDR");
     width=data.readUInt32BE(0);height=data.readUInt32BE(4);bit=data[8];kind=data[9];interlace=data[12];
   }else if(type==="PLTE")palette=data;
   else if(type==="tRNS")transparency=data;
   else if(type==="IDAT")blocks.push(data);
   else if(type==="IEND"){end=true;break;}
 }
 if(!end||!width||!height||width*height>12_000_000||bit!==8||interlace!==0||
    ![0,2,3,4,6].includes(kind)||!blocks.length)throw new Error("UNSUPPORTED_PNG_VARIANT");
 const channels=kind===0||kind===3?1:kind===2?3:kind===4?2:4;
 const stride=width*channels,max=(stride+1)*height;
 if(max>80_000_000)throw new Error("DECODED_PNG_TOO_LARGE");
 const raw=inflateSync(Buffer.concat(blocks),{maxOutputLength:max});
 if(raw.length!==max)throw new Error("PNG_SCANLINE_SIZE_MISMATCH");
 const rgb=new Uint8Array(width*height*3),prev=new Uint8Array(stride),row=new Uint8Array(stride);
 let pos=0;
 for(let y=0;y<height;y++){
   const filter=raw[pos++];if(filter>4)throw new Error("INVALID_PNG_FILTER");
   for(let x=0;x<stride;x++){
     const left=x>=channels?row[x-channels]:0,up=prev[x],upper=x>=channels?prev[x-channels]:0;
     let pred=0;
     if(filter===1)pred=left;
     else if(filter===2)pred=up;
     else if(filter===3)pred=Math.floor((left+up)/2);
     else if(filter===4){
       const p=left+up-upper,da=Math.abs(p-left),db=Math.abs(p-up),dc=Math.abs(p-upper);
       pred=da<=db&&da<=dc?left:db<=dc?up:upper;
     }
     row[x]=(raw[pos++]+pred)&255;
   }
   for(let x=0;x<width;x++){
     const start=x*channels,dst=(y*width+x)*3;let r=0,g=0,b=0,a=255;
     if(kind===2||kind===6){r=row[start];g=row[start+1];b=row[start+2];if(kind===6)a=row[start+3];}
     else if(kind===0||kind===4){r=g=b=row[start];if(kind===4)a=row[start+1];}
     else{
       const index=row[start];if(!palette||index*3+2>=palette.length)throw new Error("INVALID_PNG_PALETTE");
       r=palette[index*3];g=palette[index*3+1];b=palette[index*3+2];a=transparency?.[index]??255;
     }
     rgb[dst]=Math.round(r*a/255+255*(255-a)/255);
     rgb[dst+1]=Math.round(g*a/255+255*(255-a)/255);
     rgb[dst+2]=Math.round(b*a/255+255*(255-a)/255);
   }
   prev.set(row);
 }
 return {width,height,rgb,format:"png"};
}
function sniffDimensions(data:Buffer){
 if(data.subarray(0,8).equals(PNG))return {format:"png",width:data.readUInt32BE(16),height:data.readUInt32BE(20)};
 if(data.length>=30&&data.toString("ascii",0,4)==="RIFF"&&data.toString("ascii",8,12)==="WEBP"){
   const chunk=data.toString("ascii",12,16);
   if(chunk==="VP8X")return {format:"webp",width:1+data[24]+(data[25]<<8)+(data[26]<<16),height:1+data[27]+(data[28]<<8)+(data[29]<<16)};
   if(chunk==="VP8L"&&data[20]===0x2f)return {format:"webp",width:1+(data[21]|((data[22]&63)<<8)),height:1+((data[22]>>6)|(data[23]<<2)|((data[24]&15)<<10))};
   if(chunk==="VP8 "&&data.length>=30)return {format:"webp",width:data.readUInt16LE(26)&0x3fff,height:data.readUInt16LE(28)&0x3fff};
 }
 if(data[0]===255&&data[1]===216){
   let p=2;
   while(p+9<data.length){
     if(data[p]!==255){p++;continue;}const marker=data[p+1];p+=2;
     if(marker===0xd9||marker===0xda)break;
     if(p+2>data.length)break;const size=data.readUInt16BE(p);
     if(size<2||p+size>data.length)break;
     if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb].includes(marker))
       return {format:"jpeg",width:data.readUInt16BE(p+5),height:data.readUInt16BE(p+3)};
     p+=size;
   }
 }
 throw new Error("UNSUPPORTED_RASTER_SIGNATURE");
}
export type EoPixelReceipt={slot:string;image_url:string;sha256:string;width:number;height:number;file_bytes:number;
  pixel_inspected:boolean;mean_luminance:number|null;luminance_stddev:number|null;near_white_fraction:number|null;
  near_black_fraction:number|null;edge_strength:number|null;perceptual_hash:string|null;
  heuristic_flags:string[];measurement:"GATEWAY_DECODED_PIXELS"|"METADATA_ONLY_NOT_PIXEL_INSPECTED"};
const dist=(a:string,b:string)=>[...a].reduce((sum,char,i)=>sum+(char===b[i]?0:1),0);
export async function analyzeEoImageBytes(bytes:Buffer,slot:string,imageUrl:string):Promise<EoPixelReceipt>{
 const dim=sniffDimensions(bytes);
 if(!dim.width||!dim.height||dim.width*dim.height>12_000_000)throw new Error("INVALID_IMAGE_DIMENSIONS");
 const base={slot,image_url:imageUrl,sha256:createHash("sha256").update(bytes).digest("hex"),
  width:dim.width,height:dim.height,file_bytes:bytes.length};
 if(dim.format!=="png"){
   return {...base,pixel_inspected:false,mean_luminance:null,luminance_stddev:null,
      near_white_fraction:null,near_black_fraction:null,edge_strength:null,perceptual_hash:null,
      heuristic_flags:["RASTER_PIXEL_DECODER_UNAVAILABLE_FOR_"+dim.format.toUpperCase()],
      measurement:"METADATA_ONLY_NOT_PIXEL_INSPECTED"};
 }
 const image=decodePngBytes(bytes),w=image.width,h=image.height,n=96*96,grid=new Float32Array(n);
 let total=0,sumsq=0,white=0,black=0,edgeSum=0,edgeCount=0;
 for(let y=0;y<96;y++)for(let x=0;x<96;x++){
   const px=Math.min(w-1,Math.floor(x*w/96)),py=Math.min(h-1,Math.floor(y*h/96)),i=(py*w+px)*3;
   const gray=.2126*image.rgb[i]+.7152*image.rgb[i+1]+.0722*image.rgb[i+2],idx=y*96+x;
   grid[idx]=gray;total+=gray;sumsq+=gray*gray;if(gray>248)white++;if(gray<10)black++;
 }
 for(let y=1;y<96;y++)for(let x=1;x<96;x++){
   const i=y*96+x;edgeSum+=Math.abs(grid[i]-grid[i-1])+Math.abs(grid[i]-grid[i-96]);edgeCount+=2;
 }
 const mean=total/n,std=Math.sqrt(Math.max(0,sumsq/n-mean*mean)),edge=edgeSum/Math.max(1,edgeCount);
 let dhash="";
 for(let y=0;y<8;y++)for(let x=0;x<8;x++)dhash+=grid[(y*12)*96+x*12]>grid[(y*12)*96+(x+1)*12]?"1":"0";
 const flags:string[]=[];
 if(w<400||h<400)flags.push("LOW_RESOLUTION_FOR_LARGE_ONEPAGE_SLOT");
 if(white/n>.48)flags.push("EXTENSIVE_NEAR_WHITE_HIGHLIGHTS_REVIEW");
 if(black/n>.48)flags.push("EXTENSIVE_NEAR_BLACK_SHADOWS_REVIEW");
 if(std<22)flags.push("LOW_GLOBAL_CONTRAST_REVIEW");
 if(edge<5)flags.push("LOW_LOCAL_DETAIL_REVIEW");
 return {...base,pixel_inspected:true,mean_luminance:+mean.toFixed(2),luminance_stddev:+std.toFixed(2),
  near_white_fraction:+(white/n).toFixed(3),near_black_fraction:+(black/n).toFixed(3),
  edge_strength:+edge.toFixed(2),perceptual_hash:dhash,heuristic_flags:flags,measurement:"GATEWAY_DECODED_PIXELS"};
}
export async function auditOnepageEoPixels(images:PixelSource[],fetcher:typeof fetch=fetch){
 if(!Array.isArray(images)||!images.length||images.length>12||images.some(x=>!x||!x.slot||
    x.slot.length>80||!trustedEoImageUrl(x.image_url)))
   return {version:EO_PIXEL_AUDIT_VERSION,status:"INVALID_INPUT",results:[],issues:["INVALID_OR_UNTRUSTED_IMAGE_LIST"]};
 const results:EoPixelReceipt[]=[],issues:string[]=[];
 for(const source of images)try{
   const im=await fetchEoImage(source.image_url,fetcher);
   results.push(await analyzeEoImageBytes(im.bytes,source.slot,source.image_url));
 }catch(e){issues.push(source.slot+":"+(e instanceof Error?e.message:"IMAGE_QA_ERROR"));}
 const duplicates:{first:string;second:string;distance:number}[]=[];
 for(let i=0;i<results.length;i++)for(let j=i+1;j<results.length;j++){
   const a=results[i],b=results[j];
   if(a.perceptual_hash&&b.perceptual_hash){
     const d=dist(a.perceptual_hash,b.perceptual_hash);
     if(d<=3)duplicates.push({first:a.slot,second:b.slot,distance:d});
   }else if(a.sha256===b.sha256)duplicates.push({first:a.slot,second:b.slot,distance:0});
 }
 const count=results.filter(x=>x.pixel_inspected).length;
 return {version:EO_PIXEL_AUDIT_VERSION,status:issues.length||count<images.length?"PARTIAL_PIXEL_AUDIT":"PIXELS_MEASURED",
  images_requested:images.length,images_validated:results.length,images_measured:count,results,possible_duplicates:duplicates,issues,
  pixel_checked_by_gateway:count>0,semantic_eo_quality_certified:false,
  next_action:"PNG pixel measurements and JPG/WebP metadata do not certify subjective EO quality. For non-PNG visuals obtain genuine PNG source renders for technical pixel QA, and perform semantic product/art-direction review separately."};
}
