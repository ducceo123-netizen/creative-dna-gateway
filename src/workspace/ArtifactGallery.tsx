import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, X } from 'lucide-react';
import { safeDownloadPath } from './state';
import type { Artifact, WorkspaceTask } from './types';
export function galleryArtifacts(task: WorkspaceTask): (Artifact & { safe_path: string })[] {
  return task.artifacts.flatMap(file => {
    const path = file.verification === 'verified' && ['image/png', 'image/jpeg', 'image/webp'].includes(file.media_type) ? safeDownloadPath(file.download_url, task.task_id) : null;
    return path ? [{ ...file, safe_path: path }] : [];
  });
}
export function ArtifactGallery({ task }: { task: WorkspaceTask }) {
  const files = galleryArtifacts(task);
  const [selected, setSelected] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const dialog = useRef<HTMLDialogElement>(null);
  const active = files.find(file => file.artifact_id === selected);
  useEffect(() => { if (active) dialog.current?.showModal(); else dialog.current?.close(); }, [active?.artifact_id]);
  useEffect(() => { setSelected(null); setScale(1); }, [task.task_id]);
  if (!files.length) return null;
  return <section className="uw-artifact-gallery" aria-label="Gallery material đã xác minh"><div className="uw-section-heading"><h2>Material</h2><span>{files.length} ảnh đã xác minh</span></div>
    <div className="uw-gallery-grid">{files.map(file => <button key={file.artifact_id} onClick={() => { setSelected(file.artifact_id); setScale(1); }}><img src={file.safe_path} alt={file.filename} loading="lazy" /><strong>{file.filename}</strong><small>Phiên bản {file.revision_id}</small></button>)}</div>
    <dialog ref={dialog} className="uw-image-dialog" onCancel={() => setSelected(null)} onClose={() => setSelected(null)}><div className="uw-panel-heading"><div><strong>{active?.filename}</strong><p>Ảnh thực từ tệp đã xác minh · {active?.width} × {active?.height}</p></div><button className="uw-icon-button" aria-label="Đóng ảnh" onClick={() => setSelected(null)}><X size={20} /></button></div>
      <div className="uw-gallery-controls"><label>Thu phóng <select value={scale} onChange={event => setScale(Number(event.target.value))}>{[0.5, 1, 1.5, 2, 3].map(value => <option key={value} value={value}>{value * 100}%</option>)}</select></label>{active && <a href={active.safe_path} download><ArrowDownToLine size={17} />Tải tệp gốc</a>}</div>
      <div className="uw-image-zoom">{active && <img src={active.safe_path} alt={active.filename} style={{ width: active.width ? active.width * scale : `${scale * 100}%`, maxWidth: 'none' }} />}</div>
    </dialog>
  </section>;
}
