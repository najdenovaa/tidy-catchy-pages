// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createSessionStore, validSession } from '../../public/pdf-editor/local-session.js';

const snapshot = (name = 'Мой документ.pdf') => ({
  version: 1, name, bytes: new TextEncoder().encode('%PDF-1.7\nexample'),
  page: 2, zoom: 1.25, saved: false,
  draft: { mode: 'text', text: 'Незавершённая правка', dirty: true },
});

describe('PDF editor local sessions', () => {
  it('starts empty and restores the document, page and unfinished edits in a new connection', async () => {
    const profile = new IDBFactory();
    const first = createSessionStore(profile);
    expect(await first.read()).toBeUndefined();
    const value = snapshot();
    await first.write(value);
    const restored = await createSessionStore(profile).read();
    expect(restored).toEqual(value);
    expect(restored.bytes).not.toBe(value.bytes);
    expect(validSession(restored)).toBe(true);
  });

  it('keeps independent browser profiles separate without any IP or login', async () => {
    const personA = createSessionStore(new IDBFactory());
    const personB = createSessionStore(new IDBFactory());
    await personA.write(snapshot('A.pdf'));
    expect(await personB.read()).toBeUndefined();
    await personB.write(snapshot('B.pdf'));
    expect((await personA.read()).name).toBe('A.pdf');
    expect((await personB.read()).name).toBe('B.pdf');
  });

  it('retains the latest snapshot when saves are requested before an earlier transaction finishes', async () => {
    const store = createSessionStore(new IDBFactory());
    await Promise.all([store.write(snapshot('old.pdf')), store.write(snapshot('new.pdf'))]);
    expect((await store.read()).name).toBe('new.pdf');
  });

  it('does not destroy the previous session when a write fails and can save again afterward', async () => {
    const store = createSessionStore(new IDBFactory());
    await store.write(snapshot());
    await expect(store.write({ ...snapshot(), unsupported: () => {} })).rejects.toBeDefined();
    expect((await store.read()).name).toBe('Мой документ.pdf');
    await store.write(snapshot('recovered.pdf'));
    expect((await store.read()).name).toBe('recovered.pdf');
  });

  it('reports unavailable storage without making a false successful save', async () => {
    const store = createSessionStore(null);
    await expect(store.read()).rejects.toThrow('unavailable');
    await expect(store.write(snapshot())).rejects.toThrow('unavailable');
  });

  it('rejects corrupt, incompatible and incomplete session records', () => {
    for (const value of [null, {}, { ...snapshot(), version: 2 }, { ...snapshot(), name: '' },
      { ...snapshot(), bytes: new Uint8Array([1, 2, 3]) }, { ...snapshot(), bytes: 'not a PDF' }]) {
      expect(Boolean(validSession(value))).toBe(false);
    }
  });
});
