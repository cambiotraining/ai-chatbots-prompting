// Keep each workshop's data together in the existing Durable Object.
export class WorkshopStorage {
  constructor(storage, prefix) {
    this.storage = storage;
    this.prefix = prefix;
  }
  get(key) { return this.storage.get(`${this.prefix}${key}`); }
  put(key, value) { return this.storage.put(`${this.prefix}${key}`, value); }
  delete(keys) {
    const scopedKeys = (Array.isArray(keys) ? keys : [keys]).map(key => `${this.prefix}${key}`);
    return this.storage.delete(scopedKeys);
  }
  async list({ prefix = '' } = {}) {
    const entries = await this.storage.list({ prefix: `${this.prefix}${prefix}` });
    return new Map([...entries].map(([key, value]) => [key.slice(this.prefix.length), value]));
  }
  transaction(callback) {
    return this.storage.transaction(tx => callback(new WorkshopStorage(tx, this.prefix)));
  }
  setAlarm(timestamp) { return this.storage.setAlarm(timestamp); }
}
