import { readFile } from 'node:fs/promises';

export async function loadEnv(file = new URL('../.dev.vars', import.meta.url)) {
  const result = { ...process.env };
  try {
    const text = await readFile(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z_0-9]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      if (!result[match[1]] && !value.startsWith('replace-')) result[match[1]] = value;
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return result;
}
