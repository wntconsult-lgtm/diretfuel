import { mkdir, rm, copyFile, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/pages-preview');
const source = path.join(root, 'migration/pages');
const config = await readFile(path.join(source, 'config.mjs'), 'utf8');
if (!config.includes('sb_publishable_') || /service_role|sb_secret_|eyJ/.test(config)) {
  throw Error('A configuração deve conter somente a chave pública moderna.');
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of await readdir(source)) {
  if (/\.(html|css|js|mjs)$/.test(name)) await copyFile(path.join(source, name), path.join(output, name));
}
for (const name of ['logo-vixpar.png', 'favicon.svg']) await copyFile(path.join(root, 'public', name), path.join(output, name));
console.log('Página de acesso de testes gerada em dist/pages-preview. Nenhum dado operacional foi incluído.');
await import('./build-pages-app.mjs');
