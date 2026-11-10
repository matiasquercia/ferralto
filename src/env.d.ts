interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_WHATSAPP_NUMBER?: string;
  readonly PUBLIC_GA_ID?: string;
  readonly PUBLIC_META_PIXEL_ID?: string;
  readonly MP_ACCESS_TOKEN?: string;
  readonly MP_WEBHOOK_SECRET?: string;
  readonly NOTION_TOKEN?: string;
  readonly NOTION_DATABASE_ID?: string;
  readonly SHIPPING_ORIGIN_JSON?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
