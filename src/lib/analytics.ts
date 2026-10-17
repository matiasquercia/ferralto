type Consent = { analytics: boolean; ads: boolean; updated: number };
type Config = { ga: string; ads: string; whatsappLabel: string; checkoutLabel: string; purchaseLabel: string; pixel: string };
type Params = Record<string, unknown>;
declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & {
      queue?: unknown[];
      loaded?: boolean;
      version?: string;
      callMethod?: (...args: unknown[]) => void;
    };
  }
}
const key = 'ferrato:consent:v1';
let consent: Consent = { analytics: false, ads: false, updated: 0 };
let config: Config;
let initialized = false;
let gaReady = false;
let adsReady = false;
let googleLoaded = false;
let pixelReady = false;
const seen = new Set<string>();
function measurementUrl() {
  const safe = new URL(location.origin + location.pathname);
  const query = new URLSearchParams(location.search);
  // Keep only advertising click IDs; arbitrary queries may contain buyer information.
  for (const field of ['gclid', 'dclid', 'gbraid', 'wbraid']) {
    const value = query.get(field);
    if (value && /^[A-Za-z0-9_-]{1,512}$/.test(value)) safe.searchParams.set(field, value);
  }
  return safe.href;
}

export function ecommerceItem(item: {
  id: string;
  name: string;
  price?: number | null;
  quantity?: number;
  variant?: string;
}) {
  return {
    item_id: item.id,
    item_name: item.name,
    ...(item.price != null && { price: item.price }),
    quantity: item.quantity ?? 1,
    ...(item.variant && { item_variant: item.variant }),
  };
}

/** Only call for completed actions. Never pass buyer fields, href queries or form values. */
export function track(name: string, params: Params = {}) {
  if (!initialized) return;
  if (consent.analytics && gaReady)
    window.gtag?.('event', name, { ...params, transport_type: 'beacon', send_to: config.ga });
  const label =
    name === 'whatsapp_click' ? config.whatsappLabel : name === 'checkout_submit' ? config.checkoutLabel : '';
  if (consent.ads && adsReady && /^[A-Za-z0-9_-]+$/.test(label)) {
    window.gtag?.('event', 'conversion', { send_to: `${config.ads}/${label}` });
  }
}

function trackPageContent() {
  if (!consent.analytics || !gaReady || seen.has('content')) return;
  seen.add('content');
  const list = document.querySelector<HTMLElement>('[data-view-list]')?.dataset.viewList;
  if (list) {
    try { track('view_item_list', JSON.parse(list)); } catch { /* Optional catalogue metadata. */ }
  }
  const item = document.querySelector<HTMLElement>('[data-view-item]')?.dataset.viewItem;
  if (item) {
    try {
      const data = JSON.parse(item);
      track('view_item', {
        currency: 'ARS',
        ...(data.price != null && { value: data.price }),
        items: [data],
      });
    } catch {
      /* Invalid optional metadata must not break the page. */
    }
  }
}

function trackVerifiedPurchase() {
  const encoded = document.getElementById('verified-purchase')?.dataset?.purchase;
  if (!encoded) return;
  try {
    const purchase = JSON.parse(encoded);
    if (!/^MP-\d{1,20}$/.test(purchase.transaction_id) || purchase.currency !== 'ARS' ||
        typeof purchase.value !== 'number' || !Number.isFinite(purchase.value) || purchase.value <= 0) return;
    const ledgerKey = 'ferrato:measured-purchases:v1';
    let ledger: Record<string, number> = {};
    try {
      const stored = JSON.parse(localStorage.getItem(ledgerKey) || '{}');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [id, date] of Object.entries(stored)) {
          if (typeof date === 'number' && Date.now() - date < 30 * 86400000) ledger[id] = date;
        }
      }
    } catch { /* Storage may be unavailable; Google also deduplicates transaction_id. */ }
    const sendOnce = (channel: string, send: () => void) => {
      const id = `${channel}:${purchase.transaction_id}`;
      if (seen.has(id) || ledger[id]) return;
      send();
      seen.add(id);
      ledger[id] = Date.now();
      try { localStorage.setItem(ledgerKey, JSON.stringify(ledger)); } catch { /* in-page deduplication remains */ }
    };
    if (consent.analytics && gaReady) sendOnce('ga', () => track('purchase', purchase));
    if (consent.ads && adsReady && /^[A-Za-z0-9_-]+$/.test(config.purchaseLabel)) {
      sendOnce('ads', () => window.gtag?.('event', 'conversion', {
        send_to: `${config.ads}/${config.purchaseLabel}`,
        value: purchase.value, currency: purchase.currency, transaction_id: purchase.transaction_id,
      }));
    }
  } catch { /* Malformed optional metadata must not break the checkout result. */ }
}

function applyConsent(next: Consent) {
  consent = next;
  window.gtag?.('consent', 'update', {
    analytics_storage: next.analytics ? 'granted' : 'denied',
    ad_storage: next.ads ? 'granted' : 'denied',
    ad_user_data: next.ads ? 'granted' : 'denied',
    ad_personalization: next.ads ? 'granted' : 'denied',
  });
  // Basic consent mode: no Google/Meta requests until the relevant opt-in.
  const ga = /^G-[A-Z0-9]+$/.test(config.ga);
  const ads = /^AW-\d+$/.test(config.ads);
  if ((next.analytics && ga) || (next.ads && ads)) {
    if (!googleLoaded) {
      googleLoaded = true;
      window.gtag?.('js', new Date());
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${next.analytics && ga ? config.ga : config.ads}`;
      document.head.append(script);
    }
    if (next.analytics && ga && !gaReady) {
      gaReady = true;
      window.gtag?.('config', config.ga, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      });
      // Strip arbitrary query strings and referrers to avoid buyer/payment data leaks.
      let referrer = '';
      try {
        referrer = document.referrer ? new URL(document.referrer).origin : '';
      } catch {
        /* no referrer */
      }
      track('page_view', {
        page_location: measurementUrl(),
        page_title: document.title,
        page_referrer: referrer,
      });
    }
    if (next.ads && ads && !adsReady) {
      adsReady = true;
      window.gtag?.('config', config.ads);
    }
  }
  if (next.ads && /^\d+$/.test(config.pixel) && !pixelReady) {
    pixelReady = true;
    const fbq: NonNullable<Window['fbq']> = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue!.push(args);
    };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = '2.0';
    window.fbq = fbq;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.append(script);
    fbq('consent', 'grant');
    fbq('init', config.pixel);
    fbq('track', 'PageView');
  }
  if (pixelReady) window.fbq?.('consent', next.ads ? 'grant' : 'revoke');
  trackPageContent();
  trackVerifiedPurchase();
}

export function initializeMeasurement() {
  if (initialized) return;
  initialized = true;
  config = JSON.parse(document.getElementById('measurement-config')?.dataset.config || '{}');
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  window.gtag('set', 'ads_data_redaction', true);
  window.gtag('set', {
    page_location: measurementUrl(),
    page_referrer: document.referrer ? new URL(document.referrer).origin : '',
  });
  const notice = document.getElementById('cookie-notice')!;
  let stored: Consent | undefined;
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (
      typeof value?.analytics === 'boolean' &&
      typeof value?.ads === 'boolean' &&
      Date.now() - value.updated < 180 * 86400000
    )
      stored = value;
  } catch {
    /* Storage can be disabled. */
  }
  if (stored) applyConsent(stored);
  else notice.hidden = !Object.values(config).some(Boolean);
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const choice = target?.closest<HTMLElement>('[data-consent]');
    if (choice) {
      const next = {
        analytics: choice.dataset.consent !== 'none',
        ads: choice.dataset.consent === 'all',
        updated: Date.now(),
      };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* consent still works for this page */
      }
      const revoke = (consent.analytics && !next.analytics) || (consent.ads && !next.ads);
      applyConsent(next);
      notice.hidden = true;
      if (revoke) {
        // Unload automatic listeners belonging to previously granted tags.
        for (const cookie of document.cookie.split(';')) {
          const name = cookie.split('=')[0].trim();
          if (/^(_ga|_gid|_gat|_gcl|_fbp|_fbc)/.test(name)) {
            const domains = location.hostname.split('.');
            document.cookie = `${name}=; Max-Age=0; path=/`;
            while (domains.length > 1) {
              document.cookie = `${name}=; Max-Age=0; path=/; domain=.${domains.join('.')}`;
              domains.shift();
            }
          }
        }
        location.reload();
      }
      return;
    }
    if (target?.closest('[data-cookie-settings]')) {
      notice.hidden = false;
      notice.querySelector('button')?.focus();
      return;
    }
    const link = target?.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.origin);
    const placement = link.dataset?.contactPlacement || (link.closest('header')
      ? 'header'
      : link.closest('footer')
        ? 'footer'
        : link.closest('[data-hero]')
          ? 'hero'
          : 'content');
    // One delegated handler covers static links and React islands, including keyboard activation.
    if (url.hostname === 'wa.me' || url.hostname === 'api.whatsapp.com') {
      track('whatsapp_click', { placement, page_path: location.pathname });
    } else if (
      url.origin === location.origin &&
      /^\/productos\/[^/]+\/?$/.test(url.pathname) &&
      !url.pathname.startsWith('/productos/todos')
    ) {
      const metadata = link.closest<HTMLElement>('[data-item]')?.dataset.item;
      if (metadata) {
        try {
          track('select_item', { items: [JSON.parse(metadata)], item_list_id: location.pathname });
        } catch {
          /* optional */
        }
      }
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === key) location.reload();
  });
}
