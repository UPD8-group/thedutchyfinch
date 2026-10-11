import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
let html = await readFile('public/index.html', 'utf8');
// A new script URL accompanies each change, including for returning mobile
// visitors whose browser retained an older copy of the introduction code.
const mainScript = await readFile('public/main.js');
const mainName = `main.${createHash('sha256').update(mainScript).digest('hex').slice(0, 12)}.js`;
await writeFile(`dist/${mainName}`, mainScript);
html = html.replace('src="/main.js"', `src="/${mainName}"`);
const siteOrigin = new URL(process.env.URL || process.env.SITE_URL || 'https://the-dutchy-finch.hello490589.chatgpt.site').origin;
html = html.replace('content="/assets/finch-colour-1600.webp"', `content="${siteOrigin}/assets/finch-colour-1600.webp"`)
  .replace('<meta property="og:type" content="website">', `<meta property="og:type" content="website">\n  <meta property="og:url" content="${siteOrigin}/">\n  <link rel="canonical" href="${siteOrigin}/">`);
await writeFile('dist/index.html', html);
const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .filter((match) => match[1].trim())
  .map((match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
const headers = await readFile('public/_headers', 'utf8');
await writeFile('dist/_headers', headers.replace('__INLINE_SCRIPT_HASHES__', hashes.join(' ')));
console.log('Built The Dutchy Finch into dist/. No production dependencies.');
