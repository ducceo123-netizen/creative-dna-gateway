/// <reference types="@shopify/polaris-types" />
import type { ReactNode } from 'react';

/** Official standalone Polaris 2. No App Bridge, Shopify identity or store API access. */
export const POLARIS_SCRIPT_URL = 'https://cdn.shopify.com/shopifycloud/polaris-2.js';
let loading: Promise<void> | undefined;
export function loadPolaris(): Promise<void> {
  if (customElements.get('s-button') && customElements.get('s-text-field')) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    // Load once and do not replay task operations if a page is refreshed or a CDN request fails.
    const script = document.createElement('script');
    script.src = POLARIS_SCRIPT_URL;
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    const timeout = setTimeout(() => reject(new Error('Polaris load timed out.')), 20_000);
    script.addEventListener('load', () => {
      Promise.all(['s-button', 's-page', 's-section', 's-text-field', 's-text-area', 's-select', 's-banner', 's-email-field', 's-password-field'].map(tag => customElements.whenDefined(tag)))
        .then(() => { clearTimeout(timeout); resolve(); });
    }, { once: true });
    script.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Polaris could not be loaded.')); }, { once: true });
    document.head.append(script);
  });
  return loading;
}
export function PolarisButton({ children, primary = false, disabled, loading: pending, onClick, type = 'button', icon, className = '' }: {
  children: ReactNode; primary?: boolean; disabled?: boolean; loading?: boolean; onClick?: () => void;
  type?: 'button' | 'submit'; icon?: 'plus' | 'refresh' | 'arrow-right' | 'chat' | 'x'; className?: string;
}) {
  return <span className={`uw-polaris-button ${className}`}><s-button variant={primary ? 'primary' : 'secondary'}
    disabled={disabled} loading={pending} type={type} icon={icon} onClick={onClick}>{children}</s-button></span>;
}
