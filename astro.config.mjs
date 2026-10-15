// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// URL pública del sitio: se usa para canonical, Open Graph y sitemap.
const SITE_URL = process.env.PUBLIC_SITE_URL ?? 'https://ferralto.com';

export default defineConfig({
  site: SITE_URL,
  // Todas las páginas se pre-renderizan (HTML estático = SEO y velocidad).
  // Sólo las rutas con `export const prerender = false` (API de checkout y webhook) corren en el servidor.
  output: 'static',
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [
    react(),
    sitemap({
      filter: (page) => !page.includes('/checkout/') && !page.includes('/carrito'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    server: {
      watch: {
        ignored: ['**/.agents/**', '**/.wrangler/**'],
      },
    },
  },
});
