import { stripTypeScriptTypes } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const target = new URL('../supabase/functions/directfuel-api/core/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['directfuel-security','directfuel-invoices','directfuel-fiscal-protection','directfuel-storage','directfuel-accounting-report','directfuel-volume','directfuel-version','directfuel-geo-core','directfuel-completed-documents']) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  const code = stripTypeScriptTypes(source, { mode: 'strip' }).replaceAll('"./directfuel-invoices"', '"./directfuel-invoices.mjs"');
  await writeFile(new URL(`${name}.mjs`, target), `// Generated from lib/${name}.ts. Run node scripts/build-supabase-core.mjs.\n${code}`);
}
console.log('Validações originais preparadas para o backend Supabase.');
