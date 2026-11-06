import { useEffect, useRef } from 'react';
import type { Review } from './types';
import { selectionFromMessage } from './state';

export function Preview({ review, width, mode, selected, onSelect, readOnly = false, zoom = 1 }: {
  readOnly?: boolean; zoom?: number; review: Review; width: number; mode: 'element' | 'section'; selected: string[];
  onSelect: (id: string, width: number) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const selection = useRef(onSelect);
  selection.current = onSelect;
  const sendState = () => {
    const target = frame.current?.contentWindow;
    // An allow-scripts-only frame has an opaque origin; source + per-render nonce are verified instead.
    target?.postMessage({ type: 'uid-workspace-mode', channel_nonce: review.channel_nonce, mode }, '*');
    target?.postMessage({ type: 'uid-workspace-highlight', channel_nonce: review.channel_nonce, element_ids: selected }, '*');
  };
  useEffect(sendState, [mode, selected, review]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const id = selectionFromMessage(event.data, !!frame.current && event.source === frame.current.contentWindow, review);
      if (id && !readOnly) selection.current(id, width);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [review, width, readOnly]);
  return <div className="uw-preview-scroll"><iframe ref={frame} title={readOnly ? "Preview lịch sử, chỉ đọc" : "Preview Onepage canonical, chọn nội dung để góp ý"}
    className="uw-preview-frame" style={{ width, zoom }} sandbox="allow-scripts" referrerPolicy="no-referrer"
    srcDoc={review.html} onLoad={sendState} /></div>;
}
