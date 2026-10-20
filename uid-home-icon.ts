import { HOME_ICON_REVISION } from './supabase/functions/_shared/home-icon.ts';
/** Strict, deliberately small XML/SVG grammar for authored icons. Not a general SVG sanitizer. */
export function validateHomeIconSvg(svg: string) {
  const errors: string[] = [];
  if (typeof svg !== 'string' || svg.length > 100_000) return {ok:false,errors:['INVALID_SVG_SIZE']};
  if (/<!|<\?|&/.test(svg)) errors.push('UNSAFE_OR_EXTERNAL_CONTENT');
  const permitted:Record<string,string[]>={svg:['xmlns','width','height','viewBox','fill'],g:['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin'],path:['d','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-rule'],circle:['cx','cy','r','fill','stroke','stroke-width'],ellipse:['cx','cy','rx','ry','fill','stroke','stroke-width'],line:['x1','x2','y1','y2','stroke','stroke-width','stroke-linecap'],polyline:['points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin'],polygon:['points','fill','stroke','stroke-width','stroke-linejoin'],rect:['x','y','width','height','rx','ry','fill','stroke','stroke-width']};
  const colors=new Set(['none','black','white','#000','#000000','#fff','#ffffff','#202024']);
  const stack:string[]=[];let offset=0,roots=0,dark=false,white=false;
  for(const token of svg.matchAll(/<[^>]*>/g)){
    if(svg.slice(offset,token.index).trim())errors.push('TEXT_NOT_ALLOWED');offset=token.index!+token[0].length;
    const end=token[0].match(/^<\/([a-z]+)\s*>$/);
    if(end){if(stack.pop()!==end[1])errors.push('UNBALANCED_XML');continue;}
    const start=token[0].match(/^<([a-z]+)((?:\s[^<>]*)?)\s*(\/?)>$/);
    if(!start){errors.push('INVALID_XML_TAG');continue;}
    const [,name]=start;const selfClosing=/\/>$/.test(token[0]);const raw=start[2].replace(/\/$/,'');
    if(!permitted[name]){errors.push('VECTOR_GEOMETRY_ONLY');continue;}
    if(!stack.length){if(name!=='svg'||++roots!==1)errors.push('SINGLE_SVG_REQUIRED');}else if(name==='svg')errors.push('SINGLE_SVG_REQUIRED');
    const attrs:Record<string,string>={};let cursor=0;
    for(const a of raw.matchAll(/\s+([\w:-]+)\s*=\s*"([^"<>]*)"/g)){
      if(raw.slice(cursor,a.index).trim())errors.push('INVALID_XML_ATTRIBUTE');cursor=a.index!+a[0].length;
      if(a[1] in attrs)errors.push('DUPLICATE_ATTRIBUTE');attrs[a[1]]=a[2];
      if(!permitted[name].includes(a[1]))errors.push('UNSUPPORTED_ATTRIBUTE');
      if(['fill','stroke'].includes(a[1])){if(!colors.has(a[2].toLowerCase()))errors.push('NON_REFERENCE_COLOR');dark ||= ['black','#000','#000000','#202024'].includes(a[2].toLowerCase());white ||= a[1]==='fill'&&['white','#fff','#ffffff'].includes(a[2].toLowerCase());}
      if(['x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','stroke-width'].includes(a[1])&&!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(a[2]))errors.push('INVALID_NUMERIC_ATTRIBUTE');
    }
    if(raw.slice(cursor).trim())errors.push('INVALID_XML_ATTRIBUTE');
    if(name==='svg')for(const [key,value] of Object.entries({width:'75',height:'75',viewBox:'0 0 75 75',xmlns:'http://www.w3.org/2000/svg',fill:'none'}))if(attrs[key]!==value)errors.push('INVALID_'+key.toUpperCase());
    if(name==='rect'&&attrs.width==='75'&&attrs.height==='75'&&attrs.fill!=='none')errors.push('OPAQUE_CANVAS');
    if(!selfClosing)stack.push(name);
  }
  if(svg.slice(offset).trim()||stack.length||roots!==1)errors.push('UNBALANCED_XML');
  if(!dark)errors.push('MISSING_DARK_CONTOUR');if(!white)errors.push('MISSING_WHITE_INTERIOR');
  return {ok:errors.length===0,errors:[...new Set(errors)],revision:HOME_ICON_REVISION,visual_qc:'REQUIRED_NOT_PROVEN_BY_VALIDATOR',rendered_alpha_checked:false,owner_approved:false};
}
