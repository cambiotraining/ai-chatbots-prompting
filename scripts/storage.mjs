import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

// Local development/test adapter for the Worker's transactional key-value API.
// Production uses Cloudflare Durable Object storage, not this file.
export class LocalStorage {
  constructor(file = null) {
    this.file = file;
    this.map = new Map();
    this.tail = Promise.resolve();
    this.alarm = null;
    this.ready = file ? readFile(file, 'utf8').then(raw => { this.map = new Map(JSON.parse(raw)); }).catch(e => { if (e.code !== 'ENOENT') throw e; }) : Promise.resolve();
  }
  async get(key) { await this.ready; return structuredClone(this.map.get(key)); }
  async list({ prefix = '' } = {}) { await this.ready; return new Map([...this.map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])); }
  async put(key, value) { return this.transaction(tx => tx.put(key, value)); }
  async delete(keys) { return this.transaction(tx => tx.delete(keys)); }
  async transaction(callback) {
    const next = this.tail.then(async () => {
      await this.ready;
      const draft = structuredClone(this.map);
      const tx = {
        get: async key => structuredClone(draft.get(key)),
        put: async (key, value) => { draft.set(key, structuredClone(value)); },
        delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) draft.delete(key); },
        list: async ({ prefix = '' } = {}) => new Map([...draft].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)]))
      };
      const result = await callback(tx);
      if (this.file) { await mkdir(dirname(this.file), { recursive: true }); const temp = `${this.file}.tmp`; await writeFile(temp, JSON.stringify([...draft]), { mode: 0o600 }); await rename(temp, this.file); }
      this.map = draft;
      return result;
    });
    this.tail = next.catch(() => {});
    return next;
  }
  async setAlarm(timestamp) { this.alarm = timestamp; }
}
