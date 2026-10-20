import { useEffect, useRef, useState } from 'react';
export function HomeIconInstall({request}:{request:(url:string,init?:RequestInit)=>Promise<Response>}) {
  const [preview,setPreview]=useState<{revision:string;content_md:string}|null>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[attempted,setAttempted]=useState(false);
  const running=useRef(false),alive=useRef(true),abort=useRef(new AbortController());
  useEffect(()=>{alive.current=true;if(abort.current.signal.aborted)abort.current=new AbortController();return()=>{alive.current=false;abort.current.abort();};},[]);
  async function run(install:boolean){
    if(running.current || (install&&(!preview||attempted))) return;
    running.current=true;setBusy(true);setNotice('');
    if(install)setAttempted(true);
    try {
      const res=await request('/api/admin/home-icon/'+(install?'install':'preview'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(install?{confirm_revision:preview!.revision}:{}),signal:abort.current.signal});
      const data=await res.json();if(!alive.current)return;
      if(!res.ok)throw Error(data.error||'Chưa xác minh được kết quả.');
      if(install){if(data.installed!==true||data.branch!=='home-icon'||data.revision!==preview!.revision)throw Error('Receipt không khớp; kiểm tra route trước khi thử lại.');setNotice('Đã kích hoạt Home Icon. Tải lại trang Brand & Material để dùng. Đây không phải phê duyệt EO của ảnh mới.');}
      else {if(typeof data.revision!=='string'||typeof data.content_md!=='string')throw Error('Chưa đọc được contract.');setPreview(data);}
    } catch(e){if(alive.current)setNotice(install?'Kết quả chưa được xác minh. Kiểm tra route trước khi gửi lại. '+String(e):String(e));}
    finally {running.current=false;if(alive.current)setBusy(false);}
  }
  return <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">PawfectHouse · Home Icon</summary><p className="my-3 text-sm">Tạo nhánh icon từ keyword / collection. SVG 75×75 thật, nền ngoài trong suốt; vòng #fff1dc thuộc CSS. Chỉ admin hiện tại được kích hoạt; không đổi quyền truy cập, không tự phê duyệt ảnh mới.</p><button disabled={busy} onClick={()=>run(false)} className="border p-2 rounded">Đọc contract đã nghiên cứu</button>{preview&&<><pre className="whitespace-pre-wrap max-h-80 overflow-auto text-xs my-3">{preview.content_md}</pre><button disabled={busy||attempted} onClick={()=>run(true)} className="border p-2 rounded">Kích hoạt đúng contract Home Icon này</button></>}{notice&&<p role="status" className="text-sm my-3">{notice}</p>}</details>;
}
