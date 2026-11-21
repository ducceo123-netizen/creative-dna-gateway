import sharp from "sharp";
import {createHash} from "node:crypto";
import {readBoundedReferenceBytes} from "./supabase/functions/_shared/private-reference-access.ts";

export const EO_PIXEL_AUDIT_VERSION="uid-eo-pixel-audit/2026-11-21.v1";
export const EO_PIXEL_AUDIT_DESCRIPTION="Actually download and decode up to 12 trustworthy public store/CDN image files (PNG/JPEG/WebP) inside the Gateway. Return independent dimensions, clipping, contrast, local edge detail, perceptual duplicate warnings and exact content hashes. This is REAL pixel measurement, not a user-checkbox; it cannot judge sentimental storytelling, typography beauty, people anatomy or EO art direction without a semantic vision reviewer. A warning suggests targeted visual review, not automatic rejection.";
export type PixelSource={slot:string;image_url:string};
const brands=new Set(["pawfecthouse.com","www.pawfecthouse.com","giftsoul.co","www.giftsoul.co","soulprise.co","www.soulprise.co"]);
export function trustedEoImageUrl(value:string){
  try {
    if(typeof value!=="string"||value.length>2000||!value.startsWith("https://"))return false;
    const u=new URL(value);
    if(u.username||u.password||u.port||u.hash)return false;
    const host=u.hostname.toLowerCase();
    return brands.has(host)||host==="cdn.shopify.com"||host==="cdn.shopifycdn.net"||host==="shopifycdn.net"||host.endsWith(".shopifycdn.net");
  }catch{return false;}
}
export async function fetchEoImage(imageUrl:string,fetcher:typeof fetch=fetch){
  if(!trustedEoImageUrl(imageUrl))throw new Error("UNTRUSTED_IMAGE_ORIGIN");
  const response=await fetcher(imageUrl,{headers:{"Accept":"image/avif,image/webp,image/png,image/jpeg","User-Agent":"UID-Brands-EO-Quality/1.0"},redirect:"manual",signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error("IMAGE_HTTP_"+response.status);
  const header=response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()||"";
  if(!["image/png","image/jpeg","image/webp"].includes(header))throw new Error("UNSUPPORTED_IMAGE_MIME");
  const bytes=await readBoundedReferenceBytes(response.body,8*1024*1024);
  if(!bytes||bytes.byteLength<32)throw new Error("IMAGE_BYTES_UNAVAILABLE_OR_OVERSIZED");
  return {bytes:Buffer.from(bytes),mime:header};
}
export type EoPixelReceipt={slot:string;image_url:string;sha256:string;width:number;height:number;
  file_bytes:number;mean_luminance:number;luminance_stddev:number;
  near_white_fraction:number;near_black_fraction:number;edge_strength:number;
  perceptual_hash:string;heuristic_flags:string[];measurement:"GATEWAY_DECODED_PIXELS"};
export async function analyzeEoImageBytes(bytes:Buffer,slot:string,imageUrl:string):Promise<EoPixelReceipt>{
 const meta=await sharp(bytes,{limitInputPixels:32_000_000,failOn:"error"}).metadata();
 if(!meta.width||!meta.height||!["png","jpeg","webp"].includes(meta.format||""))throw new Error("UNSUPPORTED_OR_INVALID_RASTER");
 const raw=await sharp(bytes,{limitInputPixels:32_000_000}).resize(96,96,{fit:"fill"})
   .flatten({background:"#ffffff"}).removeAlpha().toColourspace("srgb").raw().toBuffer({resolveWithObject:true});
 const {data,info}=raw,n=info.width*info.height;const gray=new Float32Array(n);
 let sum=0,sq=0,white=0,black=0,edges=0,count=0;
 for(let i=0;i<n;i++){
   const p=i*info.channels;
   const v=.2126*data[p]+.7152*data[p+1]+.0722*data[p+2];
   gray[i]=v;sum+=v;sq+=v*v;
   if(v>248)white++;if(v<10)black++;
 }
 for(let y=1;y<info.height;y++)for(let x=1;x<info.width;x++){
   const i=y*info.width+x;
   edges+=Math.abs(gray[i]-gray[i-1])+Math.abs(gray[i]-gray[i-info.width]);count+=2;
 }
 const mean=sum/n,stdev=Math.sqrt(Math.max(0,sq/n-mean*mean)),edge=edges/Math.max(1,count);
 const hashRaw=await sharp(bytes,{limitInputPixels:32_000_000}).resize(9,8,{fit:"fill"}).grayscale().raw().toBuffer({resolveWithObject:true});
 let hash="";
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){
   const idx=y*9+x;hash+=hashRaw.data[idx]>hashRaw.data[idx+1]?"1":"0";
 }
 const warnings:string[]=[];
 if(meta.width<400||meta.height<400)warnings.push("LOW_RESOLUTION_FOR_LARGE_ONEPAGE_SLOT");
 if(white/n>.48)warnings.push("EXTENSIVE_NEAR_WHITE_HIGHLIGHTS_REVIEW");
 if(black/n>.48)warnings.push("EXTENSIVE_NEAR_BLACK_SHADOWS_REVIEW");
 if(stdev<22)warnings.push("LOW_GLOBAL_CONTRAST_REVIEW");
 if(edge<5)warnings.push("LOW_LOCAL_DETAIL_REVIEW");
 return {slot,image_url:imageUrl,sha256:createHash("sha256").update(bytes).digest("hex"),
   width:meta.width,height:meta.height,file_bytes:bytes.length,
   mean_luminance:+mean.toFixed(2),luminance_stddev:+stdev.toFixed(2),
   near_white_fraction:+(white/n).toFixed(3),near_black_fraction:+(black/n).toFixed(3),
   edge_strength:+edge.toFixed(2),perceptual_hash:hash,heuristic_flags:warnings,
   measurement:"GATEWAY_DECODED_PIXELS"};
}
const distance=(a:string,b:string)=>[...a].reduce((n,c,i)=>n+(c===b[i]?0:1),0);
export async function auditOnepageEoPixels(images:PixelSource[],fetcher:typeof fetch=fetch){
 if(!Array.isArray(images)||!images.length||images.length>12||
    images.some(x=>!x||!x.slot||x.slot.length>80||!trustedEoImageUrl(x.image_url)))
  return {version:EO_PIXEL_AUDIT_VERSION,status:"INVALID_INPUT",results:[],issues:["INVALID_OR_UNTRUSTED_IMAGE_LIST"]};
 const results:EoPixelReceipt[]=[];const issues:string[]=[];
 for(const source of images){
   try{
     const image=await fetchEoImage(source.image_url,fetcher);
     results.push(await analyzeEoImageBytes(image.bytes,source.slot,source.image_url));
   }catch(e){issues.push(source.slot+":"+(e instanceof Error?e.message:"IMAGE_AUDIT_ERROR"));}
 }
 const duplicates:{first:string;second:string;distance:number}[]=[];
 for(let i=0;i<results.length;i++)for(let j=i+1;j<results.length;j++){
   const d=distance(results[i].perceptual_hash,results[j].perceptual_hash);
   if(d<=3)duplicates.push({first:results[i].slot,second:results[j].slot,distance:d});
 }
 return {version:EO_PIXEL_AUDIT_VERSION,status:issues.length?"PARTIAL_PIXEL_AUDIT":"PIXELS_MEASURED",
   images_requested:images.length,images_measured:results.length,results,possible_duplicates:duplicates,issues,
   pixel_checked_by_gateway:true,semantic_eo_quality_certified:false,
   next_action:"Inspect photos, typography, product anatomy and creative originality semantically; pixel heuristics/duplicates alone never certify EO quality. Repair only failed slots and re-audit."};
}
