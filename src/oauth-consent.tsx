import {useEffect,useState} from "react";
import {createClient} from "@supabase/supabase-js";
const client=createClient(
  "https://wuonwttmkadwsmefjukv.supabase.co",
  "sb_publishable_NRcIK4NuC_MniBDuDhsHHQ_NlwpN0d_",
  {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}
);
type OAuthDetails={client?:{name?:string,client_name?:string},client_name?:string,
  scope?:string,scopes?:string[],redirect_uri?:string};
const authId=new URLSearchParams(location.search).get("authorization_id")||"";
export default function UidOAuthConsent(){
 const [email,setEmail]=useState(""),[userId,setUserId]=useState<string|null>(null);
 const [loading,setLoading]=useState(false),[details,setDetails]=useState<OAuthDetails|null>(null);
 const [allowed,setAllowed]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState("");
 async function refresh(){
   setError("");const {data:{user},error:authError}=await client.auth.getUser();
   if(authError||!user){setUserId(null);return;}
   const verifiedCompanyEmail=!!user.email_confirmed_at && /^[a-z0-9._%+\-]+@happyuid\.com$/i.test(user.email||"");
   if(!verifiedCompanyEmail){setUserId(user.id);setAllowed(false);setNotice("Chỉ email @happyuid.com đã xác minh mới được truy cập.");return;}
   setUserId(user.id);
   const {data:membership,error:memberError}=await client.from("creative_dna_team_members")
     .select("is_active").eq("user_id",user.id).eq("is_active",true).maybeSingle();
   if(memberError||!membership){setAllowed(false);setNotice("Tài khoản này không có quyền UID Brands member active.");return;}
   setAllowed(true);setNotice("");
   if(!authId){setError("Thiếu authorization_id. Hãy bắt đầu từ kết nối UID Brands trong ChatGPT.");return;}
   const result=await client.auth.oauth.getAuthorizationDetails(authId);
   if(result.error||!result.data){setError("Không lấy được yêu cầu cấp quyền OAuth. Vui lòng kết nối lại trong ChatGPT.");return;}
   setDetails(result.data as OAuthDetails);
 }
 useEffect(()=>{void refresh();const {data:{subscription}}=client.auth.onAuthStateChange(()=>{
   // Supabase auth events can occur while refresh is in flight; schedule a fresh read.
   setTimeout(()=>{void refresh();},0);
 });return ()=>subscription.unsubscribe();},[]);
 async function login(event:React.FormEvent){
  event.preventDefault();setLoading(true);setError("");setNotice("");
  const address=email.trim().toLowerCase();
  if(!/^[a-z0-9._%+\-]+@happyuid\.com$/.test(address)){
    setLoading(false);setError("Chỉ hỗ trợ email công ty @happyuid.com.");return;
  }
  try{
   const returnTo=new URL("/oauth/consent",location.origin);
   if(authId)returnTo.searchParams.set("authorization_id",authId);
   const result=await client.auth.signInWithOtp({email:address,
     options:{emailRedirectTo:returnTo.toString(),shouldCreateUser:true}});
   if(result.error)throw result.error;
   setNotice("Đã gửi link xác minh. Mở email công ty và bấm link để tiếp tục kết nối ChatGPT.");
  }catch(e){setError(e instanceof Error?e.message:"Không gửi được email xác minh.");}
  finally{setLoading(false);}
 }
 async function decide(approve:boolean){
  if(!userId||!allowed||!details||!authId)return;
  setLoading(true);setError("");
  try{
   const r=approve?await client.auth.oauth.approveAuthorization(authId):
     await client.auth.oauth.denyAuthorization(authId);
   if(r.error||!r.data?.redirect_url)throw r.error||new Error("Thiếu redirect URL được nhà cung cấp xác nhận.");
   const target=new URL(r.data.redirect_url);
   if(target.protocol!=="https:")throw Error("Redirect URL không an toàn.");
   location.assign(target.toString());
  }catch(e){setError(e instanceof Error?e.message:"Không xử lý được yêu cầu OAuth.");setLoading(false);}
 }
 const clientName=details?.client?.name||details?.client?.client_name||details?.client_name||"ChatGPT Connector";
 const scope=details?.scope||details?.scopes?.join(" ")||"openid email";
 return <main style={{fontFamily:"system-ui,sans-serif",background:"#f6f7f9",minHeight:"100vh",padding:"50px 16px",color:"#17202b"}}>
  <div style={{background:"white",maxWidth:460,margin:"0 auto",padding:30,borderRadius:16,boxShadow:"0 5px 30px #14263d15"}}>
   <div style={{fontSize:14,color:"#6a7280",fontWeight:600,marginBottom:8}}>UID BRANDS · MEMBER ACCESS</div>
   <h1 style={{fontSize:24,margin:"0 0 10px"}}>Kết nối UID Brands với ChatGPT</h1>
   <p style={{lineHeight:1.5,color:"#596271"}}>Đăng nhập không mật khẩu bằng email @happyuid.com. Xác minh hộp thư trước khi cấp quyền đọc Clipo Team.</p>
   {!userId?<form onSubmit={login} style={{display:"grid",gap:12}}>
      <label>Email @happyuid.com<input type="email" autoComplete="email" required
       placeholder="ten@happyuid.com" value={email} onChange={e=>setEmail(e.target.value)}
       style={{width:"100%",padding:12,boxSizing:"border-box"}}/></label>
      <button disabled={loading} type="submit"
       style={{padding:12,cursor:"pointer",background:"#172d5a",border:0,borderRadius:6,color:"white"}}>
       {loading?"Đang gửi...":"Gửi link đăng nhập"}
      </button>
      <p style={{fontSize:12,color:"#596271"}}>Không cần mật khẩu. Chỉ email công ty đã xác minh mới được cấp quyền.</p>
     </form>:!allowed?<div>
      <strong>Không được cấp quyền</strong><p>Tài khoản này không nằm trong danh sách member active.</p>
      <button onClick={()=>void client.auth.signOut()}>Đăng xuất</button>
     </div>:details?<section>
      <p><strong>{clientName}</strong> đang yêu cầu truy cập UID Brands.</p>
      <p style={{fontSize:13,color:"#596271"}}>Quyền được yêu cầu: {scope}</p>
      <p style={{fontSize:13,color:"#596271"}}>Cho phép tìm và xem reference team thông qua UID Brands. Không cấp quyền sửa Creative DNA hoặc public hoá ảnh.</p>
      <div style={{display:"flex",gap:12}}>
       <button disabled={loading} onClick={()=>void decide(false)} style={{padding:12,flex:1,cursor:"pointer"}}>Từ chối</button>
       <button disabled={loading} onClick={()=>void decide(true)}
         style={{padding:12,flex:1,cursor:"pointer",background:"#172d5a",color:"#fff",border:0,borderRadius:6}}>Cho phép</button>
      </div>
     </section>:<p>Đang xác thực yêu cầu kết nối...</p>}
   {notice&&<p role="status" style={{color:"#375f3c"}}>{notice}</p>}
   {error&&<p role="alert" style={{color:"#b3261e"}}>{error}</p>}
  </div>
 </main>;
}
