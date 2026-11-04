'use strict';
// Only ciphertext and its CAS revision survive a lock or reload. On insecure LAN HTTP,
// node-forge supplies AES-GCM because browsers do not expose SubtleCrypto there.
let forgeLoading;
async function loadForge() {
    if (window.forge) return window.forge;
    forgeLoading ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/waiter/forge.min.js';
        script.onload = () => window.forge ? resolve(window.forge) : reject(Error('DRAFT_CRYPTO_UNAVAILABLE'));
        script.onerror = () => reject(Error('DRAFT_CRYPTO_UNAVAILABLE'));
        document.head.append(script);
    });
    return forgeLoading;
}
function binary(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let result = '';
    for (let i = 0; i < data.length; i += 16384)
        result += String.fromCharCode(...data.subarray(i, i + 16384));
    return result;
}
function bytes(value) { return Uint8Array.from(value, c => c.charCodeAt(0)); }
class WaiterDraftStore {
    static async open(identity, encodedKey) {
        const raw = Uint8Array.from(atob(encodedKey), c => c.charCodeAt(0));
        const subtle = crypto.subtle;
        const forge = subtle ? null : await loadForge();
        const key = subtle ? await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) : raw;
        if (subtle) raw.fill(0);
        const scope = JSON.stringify([identity.instanceId, identity.branchId, identity.employeeId, identity.deviceId, 1]);
        const id = subtle
            ? Array.from(new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(scope)))).map(b => b.toString(16).padStart(2, '0')).join('')
            : forge.md.sha256.create().update(scope, 'utf8').digest().toHex();
        const db = await new Promise((ok, no) => { const r = indexedDB.open('bashkar-waiter-v1', 1); r.onupgradeneeded = () => r.result.createObjectStore('cipher', { keyPath: 'id' }); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
        return new WaiterDraftStore(db, key, id, scope, subtle, forge);
    }
    constructor(db, key, id, scope, subtle, forge) { Object.assign(this, { db, key, id, scope, subtle, forge }); this.tail = Promise.resolve(); this.closed = false; }
    lock() { this.closed = true; if (this.key instanceof Uint8Array) this.key.fill(0); this.key = null; this.db.close(); }
    async decrypt(record) {
        const aad = new TextEncoder().encode(this.scope + ':' + record.revision);
        if (this.subtle) return this.subtle.decrypt({ name: 'AES-GCM', iv: record.iv, additionalData: aad }, this.key, record.cipher);
        const cipher = new Uint8Array(record.cipher), tag = cipher.subarray(cipher.length - 16);
        const decipher = this.forge.cipher.createDecipher('AES-GCM', binary(this.key));
        decipher.start({ iv: binary(record.iv), additionalData: binary(aad), tagLength: 128, tag: this.forge.util.createBuffer(binary(tag)) });
        decipher.update(this.forge.util.createBuffer(binary(cipher.subarray(0, -16))));
        if (!decipher.finish()) throw Error('DRAFT_DECRYPT_FAILED');
        return bytes(decipher.output.getBytes());
    }
    async encrypt(revision, iv, plain) {
        const aad = new TextEncoder().encode(this.scope + ':' + revision);
        if (this.subtle) return this.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, this.key, plain);
        const cipher = this.forge.cipher.createCipher('AES-GCM', binary(this.key));
        cipher.start({ iv: binary(iv), additionalData: binary(aad), tagLength: 128 });
        cipher.update(this.forge.util.createBuffer(binary(plain)));
        if (!cipher.finish()) throw Error('DRAFT_ENCRYPT_FAILED');
        return bytes(cipher.output.getBytes() + cipher.mode.tag.getBytes());
    }
    async read() {
        if (this.closed) throw Error('WEB_LOCKED');
        const r = await new Promise((ok, no) => { const q = this.db.transaction('cipher').objectStore('cipher').get(this.id); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
        if (!r) return { revision: 0, drafts: {}, pending: {} };
        const plain = await this.decrypt(r);
        if (this.closed) throw Error('WEB_LOCKED');
        return { ...JSON.parse(new TextDecoder().decode(plain)), revision: r.revision };
    }
    update(fn) { const work = this.tail.then(async () => { const before = await this.read(), next = structuredClone(before); await fn(next); const revision = before.revision + 1, iv = crypto.getRandomValues(new Uint8Array(12)); delete next.revision; const cipher = await this.encrypt(revision, iv, new TextEncoder().encode(JSON.stringify(next))); if (this.closed)
        throw Error('WEB_LOCKED'); await new Promise((ok, no) => { const tx = this.db.transaction('cipher', 'readwrite'), store = tx.objectStore('cipher'), r = store.get(this.id); let conflict = false; r.onsuccess = () => { if ((r.result?.revision ?? 0) !== before.revision) {
        conflict = true;
        tx.abort();
        return;
    } store.put({ id: this.id, revision, iv, cipher }); }; tx.oncomplete = ok; tx.onerror = () => no(tx.error); tx.onabort = () => no(Error(conflict ? 'DRAFT_REVISION_CONFLICT' : 'DRAFT_STORAGE_UNAVAILABLE')); }); return { ...next, revision }; }); this.tail = work.catch(() => { }); return work; }
}
window.WaiterDraftStore = WaiterDraftStore;
