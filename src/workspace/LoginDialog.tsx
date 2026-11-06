import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { WorkspaceApi } from './api';
import { PolarisButton } from './polaris';

/** The user's own UID sign-in form. Passwords stay in this form/request only; no token UI or local persistence. */
export function LoginDialog({ open, api, onClose, onSuccess }: { open: boolean; api: WorkspaceApi; onClose: () => void; onSuccess: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  useEffect(() => {
    if (open) { dialog.current?.showModal(); setError(''); }
    else { dialog.current?.close(); setPassword(''); }
  }, [open]);
  const close = () => { if (pending) return; setPassword(''); setError(''); onClose(); };
  const login = async () => {
    if (locked.current || !email.trim() || !password) return;
    locked.current = true; setPending(true); setError('');
    const submittedPassword = password; setPassword('');
    try { const result = await api.login(email.trim(), submittedPassword); if (!result.authenticated) throw new Error('Session unverified'); onSuccess(); onClose(); }
    catch { setError('Chưa đăng nhập được. Kiểm tra tài khoản UID, mật khẩu và quyền thành viên, rồi thử lại.'); }
    finally { locked.current = false; setPending(false); }
  };
  return <dialog ref={dialog} className="uw-login-dialog" aria-labelledby="uw-login-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="uw-panel-heading"><div><span className="uw-eyebrow">UID BRANDS</span><h2 id="uw-login-title">Đăng nhập workspace</h2></div><button className="uw-icon-button" aria-label="Đóng đăng nhập" disabled={pending} onClick={close}><X size={18} /></button></div>
    <p className="uw-muted">Dùng tài khoản UID đã được cấp quyền. Mỗi người xem tác vụ riêng của mình; không cần nhập API key.</p>
    <form onSubmit={event => { event.preventDefault(); void login(); }}>
      <div className="uw-polaris-fields"><s-email-field label="Email tài khoản UID" name="email" autocomplete="email" required value={email} disabled={pending} onInput={event => setEmail(event.currentTarget.value)} />
        <s-password-field label="Mật khẩu" name="password" autocomplete="current-password" required value={password} disabled={pending} onInput={event => setPassword(event.currentTarget.value)} /></div>
      {error && <p className="uw-danger-text uw-help" role="alert">{error}</p>}
      <div className="uw-form-footer"><span>Phiên đăng nhập được máy chủ xác minh.</span><PolarisButton primary type="submit" disabled={!email.trim() || !password || pending} loading={pending}>Đăng nhập</PolarisButton></div>
    </form>
  </dialog>;
}
