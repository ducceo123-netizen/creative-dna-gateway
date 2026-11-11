import { useEffect, useState } from 'react';
import type { WorkspaceApi } from './api';
import type { Review, RevisionHistory, WorkspaceTask } from './types';
import { PolarisButton } from './polaris';
export function historyMatches(review: Review, taskId: string, revision: { content_revision: string; render_hash?: string }): boolean {
  return review.manifest.task_id === taskId && review.manifest.content_revision === revision.content_revision
    && (!revision.render_hash || review.manifest.render_hash === revision.render_hash);
}
export function HistoryPanel({ api, task, selected, onSelect, comparison, onComparison, disabled }: {
  api: WorkspaceApi; task: WorkspaceTask; selected: Review | null; onSelect: (review: Review | null) => void;
  comparison: boolean; onComparison: (value: boolean) => void; disabled: boolean;
}) {
  const [history, setHistory] = useState<RevisionHistory | null>(null);
  const [revisionId, setRevisionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setHistory(null); setRevisionId(''); onSelect(null); onComparison(false);
    api.revisions(task.task_id, controller.signal).then(result => { if (alive) setHistory(result); }).catch(() => { if (alive) setHistory(null); });
    return () => { alive = false; controller.abort(); };
  }, [api, task.task_id, task.review_manifest?.index_id]);
  useEffect(() => {
    if (!revisionId || !history) { onSelect(null); setLoading(false); return; }
    const revision = history.revisions.find(item => item.revision_id === revisionId && !item.current);
    if (!revision) return;
    const controller = new AbortController(); let alive = true; setLoading(true); setError('');
    api.historicalReview(task.task_id, revision.revision_id, controller.signal).then(result => {
      if (!alive) return;
      if (!historyMatches(result, task.task_id, revision)) throw new Error('Bản lưu không khớp phiên bản đã chọn.');
      onSelect(result);
    }).catch(error => { if (alive) { setError(error instanceof Error ? error.message : 'Chưa mở được bản lưu.'); onSelect(null); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [api, task.task_id, revisionId, history]);
  const past = history?.revisions.filter(item => !item.current && item.has_preview !== false) || [];
  if (!past.length) return <div className="uw-history-empty">Phiên bản hiện tại · Chưa có preview trước đó được máy chủ lưu.</div>;
  return <div className="uw-history-panel"><s-select label="Phiên bản kết quả" value={revisionId} disabled={disabled || loading} onChange={event => { onSelect(null); onComparison(false); setRevisionId(event.currentTarget.value); }}>
    <s-option value="">Hiện tại · {task.snapshot.content_revision}</s-option>{past.map((revision, index) => <s-option key={revision.revision_id} value={revision.revision_id}>Bản trước {past.length - index} · {new Date(revision.captured_at).toLocaleString('vi-VN')}</s-option>)}
    </s-select>
    {selected && <div className="uw-history-actions"><PolarisButton disabled={disabled} onClick={() => onComparison(!comparison)}>{comparison ? 'Xem một bản' : 'So sánh trước / sau'}</PolarisButton><PolarisButton disabled={disabled} onClick={() => { setRevisionId(''); onSelect(null); onComparison(false); }}>Về bản hiện tại</PolarisButton></div>}
    {loading && <p role="status">Đang mở đúng bản đã lưu…</p>}{error && <p className="uw-danger-text" role="alert">{error}</p>}
    {selected && <p className="uw-help">Đang xem bản lịch sử, chỉ đọc. Về bản hiện tại và chọn lại phạm vi trước khi góp ý. Các quyết định duyệt vẫn theo trạng thái máy chủ.</p>}
  </div>;
}
