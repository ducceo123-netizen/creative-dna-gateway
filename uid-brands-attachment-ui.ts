/**
 * Dependency-free attachment UI for the embedded UID Brands widget.
 * Host contracts verified against the official Plugins reference and UI guide:
 * https://developers.openai.com/plugins/reference#file-apis
 * https://developers.openai.com/plugins/build/chatgpt-ui#make-images-visible-to-the-model
 * The parent owns persistence and must preserve structured widget state on every save.
 */
export const ATTACHMENT_UI_STYLES = String.raw`
.uid-attachments{margin-top:12px}.uid-attachment-drop{padding:12px;border:1px dashed var(--border,#d4d4d8);border-radius:12px;background:var(--surface,#fafafa)}
.uid-attachment-drop[data-dragging="true"]{border-color:var(--focus,#217d54);background:var(--active,#d4f9e0)}
.uid-attachment-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}.uid-attachment-actions button,.uid-attachment-row button{border:1px solid var(--border,#d4d4d8);color:var(--fg,#111);background:var(--input,#fff);padding:7px 11px;min-height:36px;cursor:pointer;border-radius:8px;font-size:12px}
.uid-attachment-actions button:disabled,.uid-attachment-row button:disabled{opacity:.5;cursor:not-allowed}.uid-attachment-hint,.uid-attachment-meta,.uid-attachment-status{font-size:11.5px;color:var(--muted,#71717a)}
.uid-attachment-title{font-size:12.5px;font-weight:600}.uid-attachment-list{display:grid;gap:8px;margin-top:9px}.uid-attachment-row{display:flex;gap:10px;align-items:center;padding:10px;border:1px solid var(--border,#d4d4d8);border-radius:10px}
.uid-attachment-preview{width:44px;height:44px;flex:none;object-fit:cover;border-radius:7px;background:var(--surface,#fafafa)}.uid-attachment-icon{display:grid;place-items:center;font-size:10px;font-weight:600}.uid-attachment-body{min-width:0;flex:1}.uid-attachment-name{font-size:12px;font-weight:600;overflow-wrap:anywhere}.uid-attachment-row-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.uid-attachment-error{color:#b42318;font-size:12px;margin-top:6px;overflow-wrap:anywhere}.uid-attachment-drop:focus-visible{outline:2px solid var(--focus,#217d54);outline-offset:2px}
`;

/** Insert inside the widget's enclosing IIFE; declares createAttachmentController. */
export const ATTACHMENT_UI_SCRIPT = String.raw`
function createAttachmentController(options){
 const root=options.root, prefix=String(options.idPrefix||"uid-attachments"), onChange=typeof options.onChange==="function"?options.onChange:()=>{};
 if(!root)throw new Error("Attachment root is required");
 const IMAGE_LIMIT=10*1024*1024,DOCUMENT_LIMIT=1024*1024,COUNT_LIMIT=6,TEXT_LIMIT=16000;
 const imageTypes=new Set(["image/png","image/jpeg","image/webp","image/gif"]);
 const documentTypes=new Set(["text/plain","text/markdown","text/csv","application/json"]);
 const extensionTypes={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif",txt:"text/plain",md:"text/markdown",csv:"text/csv",json:"application/json"};
 let scope="brief",scopes=new Map([[scope,[]]]),files=new Map(),generation=0,sequence=0,destroyed=false,notice="",libraryPicking=false,disabled=false;
 const bridge=()=>window.openai||{};
 const list=key=>scopes.get(key)||[];
 const cleanString=(value,max)=>typeof value==="string"?value.slice(0,max):"";
 const validFileId=value=>typeof value==="string"&&value.length>0&&value.length<=512&&!/[\s\u0000-\u001f]/.test(value);
 function classify(name,type){
  const ext=String(name||"").split(".").pop().toLowerCase(),byName=extensionTypes[ext];
  let mime=String(type||"").toLowerCase().split(";")[0].trim();
  if(mime==="text/x-markdown")mime="text/markdown";if(mime==="text/json")mime="application/json";
  if(mime==="text/plain"&&documentTypes.has(byName))mime=byName;
  if(mime===""||mime==="application/octet-stream")mime=byName||"";
  if((ext==="pdf"||ext==="doc"||ext==="docx")||(!imageTypes.has(mime)&&!documentTypes.has(mime)))return {error:"Chỉ hỗ trợ PNG, JPG, WebP, GIF và TXT, MD, CSV, JSON UTF-8. PDF/DOCX chưa được hỗ trợ; hãy xuất thành TXT hoặc ảnh."};
  if(byName&&byName!==mime)return {error:"Định dạng và phần mở rộng của tệp không khớp. Hãy chọn lại tệp đúng định dạng."};
  return {mimeType:mime,kind:imageTypes.has(mime)?"image":"document"};
 }
 function safeHostUrl(value){
  if(typeof value!=="string"||value.length>8192)return "";
  try{const url=new URL(value),host=url.hostname.toLowerCase();
   // Preview only fresh, host-issued HTTPS URLs. Never trust URLs from saved state.
   if(url.protocol!=="https:"||url.username||url.password||!host.includes(".")||host.endsWith(".localhost")||host.endsWith(".local")||/^[\d.]+$/.test(host)||host.includes(":"))return "";
   return url.href;
  }catch{return "";}
 }
 function revoke(item){if(item.objectUrl){try{URL.revokeObjectURL(item.objectUrl);}catch{}item.objectUrl="";}item.previewUrl="";}
 function viewItem(item){
  const saved={id:item.id,fileName:item.fileName,mimeType:item.mimeType,size:item.size,kind:item.kind,status:item.status,source:item.source};
  if(item.fileId)saved.fileId=item.fileId;
  if(item.status==="ready"&&item.kind==="document"){saved.text=item.text;saved.truncated=!!item.truncated;saved.evidenceOrigin=item.evidenceOrigin||"host";}
  if(item.error)saved.error=item.error;
  return saved;
 }
 function snapshot(){const saved=Object.create(null);for(const [key,items]of scopes)saved[key]=items.map(viewItem);return {version:1,scope,scopes:saved};}
 function changed(){if(destroyed)return;render();onChange(snapshot());}
 function statusText(item){
  if(item.status==="ready")return item.kind==="document"?(item.truncated?"Sẵn sàng · nội dung đã rút gọn":"Sẵn sàng · đã đọc nội dung"):"Sẵn sàng";
  return {uploading:"Đang tải lên…",reading:"Đang đọc và kiểm tra tệp…",error:item.error||"Không thể xử lý tệp.",needs_reselect:"Tải lên bị gián đoạn. Vui lòng xóa và chọn lại tệp."}[item.status]||"Đang chuẩn bị…";
 }
 function sizeLabel(size){if(!Number.isFinite(size))return "Đang kiểm tra kích thước";return size>=1024*1024?(size/1024/1024).toFixed(1)+" MB":Math.max(1,Math.ceil(size/1024))+" KB";}
 function element(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
 root.classList.add?.("uid-attachments");
 const drop=element("div","uid-attachment-drop");drop.id=prefix+"-drop";drop.tabIndex=0;drop.setAttribute("role","group");drop.setAttribute("aria-label","Tệp tham khảo: dán, kéo thả hoặc chọn tệp");
 const title=element("div","uid-attachment-title","Ảnh / tệp tham khảo"),hint=element("div","uid-attachment-hint","Dán ảnh, kéo thả hoặc chọn tối đa 6 tệp. Ảnh ≤ 10 MB; TXT, MD, CSV, JSON UTF-8 ≤ 1 MB. PDF/DOCX chưa hỗ trợ.");
 hint.id=prefix+"-hint";drop.setAttribute("aria-describedby",hint.id);
 const disclosure=element("div","uid-attachment-hint","Tệp bạn chọn sẽ được tải lên ChatGPT cho yêu cầu này. Tài liệu được đọc tại đây; tệp thư viện được UID kiểm tra khi cần.");
 const actions=element("div","uid-attachment-actions"),picker=element("button","","Chọn tệp"),library=element("button","","Từ thư viện ChatGPT");picker.type=library.type="button";
 const input=element("input");input.type="file";input.multiple=true;input.accept=".png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.json,image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown,text/csv,application/json";input.hidden=true;input.id=prefix+"-input";input.setAttribute("aria-label","Chọn ảnh hoặc tệp tham khảo");
 picker.onclick=()=>input.click();input.onchange=()=>{const selected=Array.from(input.files||[]);input.value="";addFiles(selected);};library.onclick=()=>selectLibrary();
 actions.append(picker,library,input);drop.append(title,hint,disclosure,actions);
 const message=element("div","uid-attachment-error");message.setAttribute("role","status");message.setAttribute("aria-live","polite");
 const rows=element("div","uid-attachment-list");rows.setAttribute("aria-live","polite");
 root.replaceChildren(drop,message,rows);
 function render(){
  const api=bridge();picker.disabled=disabled||typeof api.uploadFile!=="function"||list(scope).length>=COUNT_LIMIT;
  library.hidden=typeof api.selectFiles!=="function";library.disabled=disabled||libraryPicking||list(scope).length>=COUNT_LIMIT;
  message.textContent=notice||((typeof api.uploadFile!=="function")?"ChatGPT chưa cung cấp tải tệp ở giao diện này. Bạn có thể chọn thư viện nếu có hoặc đính kèm tệp trong cuộc trò chuyện.":"");
  rows.replaceChildren();
  for(const item of list(scope)){
   const row=element("div","uid-attachment-row");row.setAttribute("data-attachment-id",item.id);row.setAttribute("data-status",item.status);
   const preview=item.objectUrl||item.previewUrl;
   if(item.kind==="image"&&preview){const img=element("img","uid-attachment-preview");img.src=preview;img.alt="Ảnh tham khảo: "+item.fileName;img.referrerPolicy="no-referrer";img.onerror=()=>{img.hidden=true;};row.appendChild(img);}
   else row.appendChild(element("div","uid-attachment-preview uid-attachment-icon",item.kind==="image"?"ẢNH":"TỆP"));
   const body=element("div","uid-attachment-body");body.append(element("div","uid-attachment-name",item.fileName),element("div","uid-attachment-meta",(item.mimeType||"Không rõ loại")+" · "+sizeLabel(item.size)),element("div",item.status==="error"||item.status==="needs_reselect"?"uid-attachment-error":"uid-attachment-status",statusText(item)));
   const controls=element("div","uid-attachment-row-actions");
   if(item.status==="error"&&!item.invalid&&(files.has(item.id)||item.source==="library"&&validFileId(item.fileId))){const retryButton=element("button","","Thử lại");retryButton.type="button";retryButton.disabled=disabled;retryButton.setAttribute("aria-label","Thử lại "+item.fileName);retryButton.onclick=()=>retry(item.id);controls.appendChild(retryButton);}
   const removeButton=element("button","","Xóa");removeButton.type="button";removeButton.disabled=disabled;removeButton.setAttribute("aria-label","Xóa "+item.fileName);removeButton.onclick=()=>remove(item.id);controls.appendChild(removeButton);
   row.append(body,controls);rows.appendChild(row);
  }
 }
 function newItem(data,key){
  const item={id:prefix+"-"+(++sequence)+"-"+Date.now().toString(36),fileName:cleanString(data.fileName,255)||"Tệp không tên",mimeType:"",kind:"document",size:Number.isFinite(data.size)?data.size:null,status:"uploading",source:data.source||"local",fileId:validFileId(data.fileId)?data.fileId:"",error:"",invalid:false,attempt:0};
  const type=classify(item.fileName,data.mimeType);Object.assign(item,type);
  const limit=item.kind==="image"?IMAGE_LIMIT:DOCUMENT_LIMIT;
  if(type.error||item.size!==null&&(item.size<1||item.size>limit)){
   item.status="error";item.invalid=true;item.error=type.error||(item.size<1?"Tệp rỗng. Hãy chọn tệp có nội dung.":"Tệp vượt quá giới hạn "+(item.kind==="image"?"10 MB cho ảnh.":"1 MB cho tài liệu."));
  }
  if(!scopes.has(key))scopes.set(key,[]);scopes.get(key).push(item);return item;
 }
 function isCurrent(item,key,epoch,attempt){return !destroyed&&epoch===generation&&item.attempt===attempt&&list(key).includes(item);}
 async function freshUrl(fileId){const api=bridge();if(typeof api.getFileDownloadUrl!=="function")throw new Error("ChatGPT chưa hỗ trợ đọc tệp này. Hãy thử lại trong giao diện có hỗ trợ tệp.");let result;try{result=await api.getFileDownloadUrl({fileId});}catch{throw new Error("Không thể lấy đường dẫn tệp từ ChatGPT. Hãy thử lại.");}const url=safeHostUrl(result?.downloadUrl);if(!url)throw new Error("ChatGPT chưa trả về đường dẫn tệp HTTPS hợp lệ. Hãy thử lại.");return url;}

 async function readLocalDocument(item,file){
  if(!file||typeof file.arrayBuffer!=="function"||typeof TextDecoder!=="function")throw new Error("Trình duyệt chưa hỗ trợ đọc tài liệu này. Hãy đính kèm nội dung văn bản trong cuộc trò chuyện.");
  let buffer;try{buffer=await file.arrayBuffer();}catch{throw new Error("Không thể đọc tệp cục bộ. Hãy xóa và chọn lại tệp.");}
  if(!buffer||!Number.isFinite(buffer.byteLength)||buffer.byteLength<1||buffer.byteLength>DOCUMENT_LIMIT)throw new Error("Tài liệu phải có nội dung và không vượt quá 1 MB.");
  const bytes=new Uint8Array(buffer);
  if(bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46||bytes[0]===0x50&&bytes[1]===0x4b||bytes[0]===0xff&&bytes[1]===0xd8||bytes[0]===0x89&&bytes[1]===0x50||bytes[0]===0x1f&&bytes[1]===0x8b)throw new Error("Tệp là định dạng nhị phân không được hỗ trợ. Hãy xuất thành TXT UTF-8.");
  let text;try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw new Error("Tài liệu không phải văn bản UTF-8 hợp lệ. Hãy xuất thành TXT UTF-8.");}
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(text))throw new Error("Tài liệu chứa ký tự điều khiển hoặc dữ liệu nhị phân không hỗ trợ.");
  if(/^\s*(?:<!doctype\s+html\b|<html\b|<\?xml\b|<svg\b|<script\b)/i.test(text))throw new Error("HTML, XML, SVG và script chưa được hỗ trợ. Hãy xuất thành TXT UTF-8.");
  if(!text.trim())throw new Error("Tài liệu không có nội dung văn bản.");
  if(item.mimeType==="application/json"){try{JSON.parse(text);}catch{throw new Error("JSON chưa hợp lệ. Hãy sửa tệp rồi chọn lại.");}}
  if(item.mimeType==="text/csv"){
   let quoted=false,afterQuote=false,fieldStart=true;
   for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"')i++;else{quoted=false;afterQuote=true;}}}else if(ch===","||ch==="\n"||ch==="\r"){fieldStart=true;afterQuote=false;}else if(ch==='"'&&fieldStart&&!afterQuote){quoted=true;fieldStart=false;}else if(ch==='"'||afterQuote)throw new Error("CSV có dấu ngoặc kép không hợp lệ. Hãy xuất lại CSV UTF-8.");else fieldStart=false;}
   if(quoted)throw new Error("CSV có dấu ngoặc kép chưa đóng. Hãy xuất lại CSV UTF-8.");
  }
  let end=Math.min(text.length,TEXT_LIMIT);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
  return {text:text.slice(0,end),truncated:end<text.length,size:bytes.byteLength,evidenceOrigin:"local"};
 }
 function readIngestion(result,item){
  if(result?.isError||result?.structuredContent?.ok===false){
   const code=result?.structuredContent?.error?.code;
   const errors={DOWNLOAD_NOT_CONFIGURED:"Chưa bật đọc tệp thư viện trên UID. Tải tệp về rồi chọn từ máy (TXT/MD/CSV/JSON hoặc ảnh), hoặc nhờ quản trị viên cấu hình.",DOWNLOAD_FAILED:"Đường dẫn tệp có thể đã hết hạn. Hãy thử lại để lấy đường dẫn mới.",DOWNLOAD_TIMED_OUT:"Đọc tệp quá thời gian. Hãy thử lại.",DOWNLOAD_TOO_LARGE:"Tệp vượt quá giới hạn: ảnh 10 MB, tài liệu 1 MB.",UNSUPPORTED_FILE_TYPE:"Định dạng chưa hỗ trợ. Hãy chọn PNG, JPG, WebP, GIF hoặc TXT, MD, CSV, JSON UTF-8.",INVALID_TEXT:"Tài liệu không phải văn bản UTF-8 hợp lệ. Hãy xuất lại TXT UTF-8.",INVALID_JSON:"JSON chưa hợp lệ. Hãy sửa tệp rồi chọn lại.",INVALID_CSV:"CSV chưa hợp lệ. Hãy xuất lại CSV UTF-8.",EMPTY_ATTACHMENT:"Tệp không có nội dung đọc được."};
   throw new Error(errors[code]||"Không thể xác minh tệp thư viện. Hãy thử lại hoặc chọn tệp từ thiết bị.");
  }
  const data=result?.structuredContent;
  if(!data||data.ok!==true||data.file_id!==item.fileId||!Number.isFinite(data.size_bytes)||data.size_bytes<1)throw new Error("Không thể xác minh nội dung tệp. Hãy thử lại.");
  const type=classify(item.fileName,data.mime_type||item.mimeType);
  if(type.error||type.kind!==item.kind||data.size_bytes>(item.kind==="image"?IMAGE_LIMIT:DOCUMENT_LIMIT))throw new Error("Tệp không đúng định dạng hoặc vượt quá giới hạn kích thước.");
  item.size=data.size_bytes;
  if(item.kind==="document"){
   if(typeof data.text!=="string"||!data.text.trim()||data.text.length>TEXT_LIMIT)throw new Error("Chưa nhận được nội dung văn bản hợp lệ. Hãy thử lại với TXT UTF-8 ngắn hơn.");
   item.text=data.text;item.truncated=!!data.truncated;item.evidenceOrigin="host";
  }
 }
 async function process(item,key){
  const epoch=generation,attempt=++item.attempt;if(item.invalid)return;
  item.error="";item.status=item.fileId?"reading":"uploading";changed();
  try{
   if(!item.fileId){const file=files.get(item.id),api=bridge();if(!file)throw new Error("Vui lòng xóa và chọn lại tệp để tiếp tục.");if(typeof api.uploadFile!=="function")throw new Error("ChatGPT chưa hỗ trợ tải tệp ở giao diện này.");let result;try{result=await api.uploadFile(file);}catch{throw new Error("Không thể tải tệp lên ChatGPT. Hãy thử lại.");}if(!isCurrent(item,key,epoch,attempt))return;if(!validFileId(result?.fileId))throw new Error("ChatGPT chưa trả về mã tệp hợp lệ. Hãy thử lại.");item.fileId=result.fileId;}
   if(!isCurrent(item,key,epoch,attempt))return;
   if(item.kind==="document"&&item.source==="local"){
    item.status="reading";changed();const evidence=await readLocalDocument(item,files.get(item.id));if(!isCurrent(item,key,epoch,attempt))return;Object.assign(item,evidence);
   }else if(item.source==="library"){
    item.status="reading";changed();const url=await freshUrl(item.fileId);if(!isCurrent(item,key,epoch,attempt))return;
    const api=bridge();if(typeof api.callTool!=="function")throw new Error("ChatGPT chưa hỗ trợ đọc nội dung tệp. Hãy thử lại.");
    let result;try{result=await api.callTool("ingest_uid_brands_attachment",{file:{download_url:url,file_id:item.fileId,mime_type:item.mimeType,file_name:item.fileName}});}catch{throw new Error("Không thể kiểm tra tệp thư viện. Hãy thử lại hoặc chọn tệp từ thiết bị.");}
    if(!isCurrent(item,key,epoch,attempt))return;readIngestion(result,item);if(item.kind==="image")item.previewUrl=url;
   }
   if(!isCurrent(item,key,epoch,attempt))return;item.status="ready";changed();
  }catch(error){if(!isCurrent(item,key,epoch,attempt))return;item.status="error";item.error=error instanceof Error?error.message:"Không thể xử lý tệp. Hãy thử lại.";changed();}
 }
 function addFiles(selected){
  if(destroyed||disabled)return Promise.resolve();const key=scope,pending=[];notice="";
  for(const file of Array.from(selected||[])){
   if(list(key).length>=COUNT_LIMIT){notice="Mỗi brief hoặc lượt review chỉ nhận tối đa 6 tệp. Xóa bớt tệp để thêm mới.";break;}
   const item=newItem({fileName:file.name,mimeType:file.type,size:file.size,source:"local"},key);files.set(item.id,file);
   if(!item.invalid&&item.kind==="image"&&typeof URL.createObjectURL==="function"){try{item.objectUrl=URL.createObjectURL(file);}catch{}}
   pending.push(item);
  }
  changed();return Promise.all(pending.filter(item=>!item.invalid).map(item=>process(item,key)));
 }
 async function selectLibrary(){
  if(destroyed||disabled||libraryPicking)return;const api=bridge();if(typeof api.selectFiles!=="function"){notice="Thư viện ChatGPT chưa khả dụng. Hãy dùng Chọn tệp.";changed();return;}
  const key=scope,epoch=generation;libraryPicking=true;notice="";render();
  try{
   let selected;try{selected=await api.selectFiles();}catch(error){if(error?.name==="AbortError")return;throw new Error("Không thể mở thư viện ChatGPT. Hãy thử lại hoặc chọn tệp từ thiết bị.");}if(destroyed||generation!==epoch)return;if(!Array.isArray(selected))throw new Error("Không thể đọc lựa chọn từ thư viện ChatGPT.");
   const pending=[];
   for(const file of selected){
    if(list(key).length>=COUNT_LIMIT){notice="Mỗi brief hoặc lượt review chỉ nhận tối đa 6 tệp. Xóa bớt tệp để thêm mới.";break;}
    if(!validFileId(file?.fileId)||typeof file.fileName!=="string"||typeof file.mimeType!=="string"){notice="ChatGPT trả về tệp thư viện chưa hợp lệ. Hãy chọn lại.";continue;}
    if(list(key).some(item=>item.fileId===file.fileId))continue;
    pending.push(newItem({fileName:file.fileName,mimeType:file.mimeType,fileId:file.fileId,source:"library"},key));
   }
   changed();await Promise.all(pending.filter(item=>!item.invalid).map(item=>process(item,key)));
  }catch(error){if(!destroyed&&generation===epoch){notice=error instanceof Error?error.message:"Không thể mở thư viện ChatGPT. Hãy thử lại.";changed();}}
  finally{if(!destroyed&&generation===epoch){libraryPicking=false;render();}}
 }
 function remove(id){if(disabled||destroyed)return false;for(const items of scopes.values()){const index=items.findIndex(item=>item.id===id);if(index>=0){const [item]=items.splice(index,1);item.attempt++;revoke(item);files.delete(id);notice="";changed();return true;}}return false;}
 function retry(id){if(disabled||destroyed)return Promise.resolve();for(const [key,items]of scopes){const item=items.find(item=>item.id===id);if(item&&item.status==="error"&&!item.invalid&&(files.has(id)||item.source==="library"&&validFileId(item.fileId)))return process(item,key);}return Promise.resolve();}
 function handlePaste(event){
  const data=event.clipboardData;if(!data||disabled||destroyed)return false;
  const pasted=Array.from(data.files||[]);
  if(!pasted.length)for(const item of Array.from(data.items||[])){if(item.kind==="file"){const file=item.getAsFile?.();if(file)pasted.push(file);}}
  if(!pasted.length)return false;event.preventDefault();addFiles(pasted);return true;
 }
 function handleDrop(event){event.preventDefault();drop.setAttribute("data-dragging","false");if(!disabled&&!destroyed&&event.dataTransfer?.files?.length)addFiles(event.dataTransfer.files);}
 const dragOver=event=>{event.preventDefault();drop.setAttribute("data-dragging","true");};
 const dragLeave=()=>drop.setAttribute("data-dragging","false");
 root.addEventListener("paste",handlePaste);drop.addEventListener("drop",handleDrop);drop.addEventListener("dragover",dragOver);drop.addEventListener("dragleave",dragLeave);
 function setScope(key){if(destroyed)return;const next=cleanString(key,2048);if(!next)throw new Error("Attachment scope is required");scope=next;if(!scopes.has(scope))scopes.set(scope,[]);notice="";render();}
 function getReadyAttachments(){return list(scope).filter(item=>item.status==="ready").map(item=>{const result={id:item.id,fileId:item.fileId,fileName:item.fileName,mimeType:item.mimeType,size:item.size,kind:item.kind};result.untrustedEvidence=true;if(item.kind==="document"){result.text=item.text;result.truncated=!!item.truncated;result.evidenceOrigin=item.evidenceOrigin||"host";}return result;});}
 function getImageIds(){return [...new Set(getReadyAttachments().filter(item=>item.kind==="image").map(item=>item.fileId))];}
 function validateReady(){const current=list(scope);if(libraryPicking)throw new Error("Hãy hoàn tất hoặc đóng lựa chọn tệp trước khi gửi.");if(current.some(item=>item.status==="uploading"||item.status==="reading"))throw new Error("Tệp đang được xử lý. Chờ trạng thái Sẵn sàng trước khi gửi.");if(current.some(item=>item.status!=="ready"))throw new Error("Có tệp chưa sẵn sàng. Hãy thử lại, chọn lại hoặc xóa tệp lỗi trước khi gửi.");return true;}
 async function ensureModelVisibility(privateState,modelContent){validateReady();const api=bridge();if(typeof api.setWidgetState!=="function"&&getReadyAttachments().length)throw new Error("ChatGPT chưa hỗ trợ chia sẻ tệp với mô hình ở giao diện này.");if(typeof api.setWidgetState==="function")await api.setWidgetState({modelContent,privateContent:privateState,imageIds:getImageIds()});}
 async function restorePreview(item,key,epoch){try{const url=await freshUrl(item.fileId);if(!destroyed&&generation===epoch&&list(key).includes(item)){item.previewUrl=url;render();}}catch{/* Missing preview never changes a ready host file into missing evidence. */}}
 function restore(saved){
  generation++;libraryPicking=false;for(const items of scopes.values())for(const item of items)revoke(item);files.clear();scopes=new Map();notice="";const restoredIds=new Set();
  if(saved?.version===1&&saved.scopes&&typeof saved.scopes==="object")for(const [key,items]of Object.entries(saved.scopes)){
   if(!key||key.length>2048||!Array.isArray(items))continue;const restored=[];
   for(const raw of items.slice(0,COUNT_LIMIT)){
    if(!raw||typeof raw!=="object")continue;
    const savedId=cleanString(raw.id,200);const id=savedId&&!restoredIds.has(savedId)?savedId:prefix+"-restored-"+(++sequence);restoredIds.add(id);
    const item={id,fileName:cleanString(raw.fileName,255)||"Tệp không tên",mimeType:cleanString(raw.mimeType,128),kind:"document",size:Number.isFinite(raw.size)?raw.size:null,status:"needs_reselect",source:raw.source==="library"?"library":"local",error:"",attempt:0};
    const type=classify(item.fileName,item.mimeType);if(!type.error){item.kind=type.kind;item.mimeType=type.mimeType;}
    const max=item.kind==="image"?IMAGE_LIMIT:DOCUMENT_LIMIT;
    if(raw.status==="ready"&&!type.error&&validFileId(raw.fileId)&&Number.isFinite(item.size)&&item.size>0&&item.size<=max&&(item.kind==="image"||typeof raw.text==="string"&&raw.text.trim()&&raw.text.length<=TEXT_LIMIT)){
     item.fileId=raw.fileId;item.status="ready";if(item.kind==="document"){item.text=raw.text;item.truncated=!!raw.truncated;item.evidenceOrigin=raw.evidenceOrigin==="local"?"local":"host";}
    }
    restored.push(item);
   }
   scopes.set(key,restored);
  }
  scope=typeof saved?.scope==="string"&&scopes.has(saved.scope)?saved.scope:"brief";if(!scopes.has(scope))scopes.set(scope,[]);render();
  for(const [key,items]of scopes)for(const item of items)if(item.status==="ready"&&item.kind==="image")restorePreview(item,key,generation);
 }
 function refreshCapabilities(){render();}
 function setDisabled(value){disabled=!!value;render();}
 function destroy(){destroyed=true;generation++;for(const items of scopes.values())for(const item of items)revoke(item);files.clear();root.removeEventListener?.("paste",handlePaste);drop.removeEventListener?.("drop",handleDrop);drop.removeEventListener?.("dragover",dragOver);drop.removeEventListener?.("dragleave",dragLeave);}
 render();return {setScope,snapshot,restore,getReadyAttachments,getImageIds,validateReady,ensureModelVisibility,addFiles,selectLibrary,remove,retry,handlePaste,handleDrop,refreshCapabilities,setDisabled,destroy};
}
`;
