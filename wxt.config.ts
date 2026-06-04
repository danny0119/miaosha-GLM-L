import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  outDir: 'output',
  vite: () => ({
    plugins: [
      {
        name: 'remove-crossorigin',
        enforce: 'post',
        transformIndexHtml(html: string) {
          return html.replace(/\bcrossorigin\b(="[^"]*")?/g, '');
        },
      },
    ],
  }),
  manifest: {
    name: '智谱秒杀助手',
    description: '智谱 Coding Plan 秒杀助手浏览器扩展',
    permissions: ['storage', 'tabs', 'scripting', 'alarms', 'notifications', 'debugger'],
    host_permissions: ['*://*.bigmodel.cn/*', '<all_urls>', 'http://localhost:8888/*'],
    sandbox: {
      pages: ['ocr-sandbox.html'],
    },
    web_accessible_resources: [
      {
        resources: ['bm-main.js', 'ocr-sandbox.html'],
        matches: ['*://*.bigmodel.cn/*'],
      },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  background: {
    // WXT auto-discovers entrypoints/background/sw.ts with "background" in path
  },
});
