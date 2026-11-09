import { copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let packageUrl;
try {
  packageUrl = pathToFileURL(require.resolve('markdown-it/package.json'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.error('Run npm install to install the Markdown renderer, then try again.');
  process.exit(1);
}

await copyFile(new URL('./dist/browser/markdown-it.esm.min.mjs', packageUrl), new URL('../public/markdown-it.mjs', import.meta.url));
await copyFile(new URL('./LICENSE', packageUrl), new URL('../public/markdown-it.LICENSE', import.meta.url));
