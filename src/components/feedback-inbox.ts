import type { FeedbackProposal } from './feedback-review';

export const feedbackStatuses = [
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'resolved', label: 'Đã có quy chuẩn' },
  { value: 'merged', label: 'Đã merge' },
  { value: 'rejected', label: 'Từ chối' },
  { value: 'accepted', label: 'Accepted cũ' },
  { value: 'all', label: 'Tất cả' },
];
export function sourceBrand(proposal: FeedbackProposal) {
  const name = proposal.brand_name?.trim();
  const key = name?.toLocaleLowerCase() || '__unknown__';
  const known: Record<string, string> = { pawfecthouse: 'PawfectHouse', giftsoul: 'GiftSoul', soulprise: 'SoulPrise' };
  return { key, label: name ? known[key] || name : 'Chưa xác định brand' };
}
export function feedbackTitle(proposal: FeedbackProposal): string {
  const overview = proposal.evidence_summary?.admin_overview as Record<string, unknown> | undefined;
  for (const candidate of [overview?.summary, proposal.change_summary, proposal.raw_feedback?.split('--- AI INTERPRETED TRAINING SPEC ---')[0], proposal.proposed_content_md]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.replace(/\s+/g, ' ').trim();
  }
  return 'Feedback chưa có tóm tắt';
}
export function materialKey(proposal: FeedbackProposal) {
  return proposal.branch_slug?.trim() || proposal.branch_title?.trim() || '__unknown__';
}
export function materialLabel(proposal: FeedbackProposal) {
  return proposal.branch_title?.trim() || proposal.branch_slug?.trim() || 'Chưa xác định material';
}
const searchable = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase();
export function filterFeedback(proposals: FeedbackProposal[], filters: { status: string; brand: string; material: string; search: string }) {
  const query = searchable(filters.search.trim());
  return proposals.filter(p =>
    (filters.status === 'all' || p.status === filters.status) &&
    (filters.brand === 'all' || sourceBrand(p).key === filters.brand) &&
    (filters.material === 'all' || materialKey(p) === filters.material) &&
    (!query || searchable([feedbackTitle(p), p.submitted_by_name, p.brand_name, materialLabel(p), p.id, p.proposed_scope, p.raw_feedback, p.proposed_content_md].filter(Boolean).join(' ')).includes(query)),
  );
}
/** Source-brand grouping is presentation only. Never derive mutation targets from these groups. */
export function groupFeedback(proposals: FeedbackProposal[]) {
  const groups = new Map<string, { key: string; label: string; proposals: FeedbackProposal[] }>();
  for (const proposal of proposals) {
    const brand = sourceBrand(proposal);
    if (!groups.has(brand.key)) groups.set(brand.key, { ...brand, proposals: [] });
    groups.get(brand.key)!.proposals.push(proposal);
  }
  return [...groups.values()].sort((a, b) => a.key === '__unknown__' ? 1 : b.key === '__unknown__' ? -1 : a.label.localeCompare(b.label));
}
export function feedbackDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Chưa có ngày';
  return new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}
