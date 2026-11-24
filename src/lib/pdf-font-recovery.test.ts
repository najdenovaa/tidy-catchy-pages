import { afterEach, expect, it, vi } from 'vitest';
import { InlineEditor } from '../../public/pdf-editor/inline.js';
import { prepareBrowserFont } from '../../public/pdf-editor/browser-fonts.js';
function editing(loadFont) {
  const editor = Object.create(InlineEditor.prototype);
  editor.draft = { font: 'Times New Roman', text: 'Правка пользователя', fontReady: false };
  editor.toolbar = document.createElement('div');
  editor.toolbar.innerHTML = '<select name="font"><option>Times New Roman</option><option>Liberation Serif</option><option>Noto Sans</option></select><button data-action="apply"></button><button data-action="retry-font" hidden></button>';
  editor.loadFont = loadFont; editor.message = vi.fn(); editor.updateDraft = vi.fn();
  return editor;
}
afterEach(() => vi.unstubAllGlobals());
it('shifts following content for both extra lines and a manually lowered text field', () => {
  const editor = Object.create(InlineEditor.prototype);
  editor.draft = { mode: 'text', font: 'Noto Sans', size: 12, originalSize: 12, lineHeight: 15,
    text: 'Первая строка\nВторая строка', width: 200, rows: 1, baseline: 125, originalBaseline: 100,
    dirty: true, shift: true, color: '#000000' };
  editor.measure = text => text.length * 5;
  expect(editor.plan().delta).toBe(40);
  editor.draft.shift = false;
  expect(editor.plan().delta).toBe(0);
});
it('recovers from a failed office alias using its preloaded core font without losing edits', async () => {
  const editor = editing(vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined));
  editor.prepareFont();
  await vi.waitFor(() => expect(editor.draft.fontReady).toBe(true));
  expect(editor.draft.font).toBe('Liberation Serif');
  expect(editor.draft.text).toBe('Правка пользователя');
  expect(editor.toolbar.querySelector('[data-action="apply"]').disabled).toBe(false);
});
it('shows an actionable retry after both loads fail and can recover', async () => {
  const load = vi.fn().mockRejectedValue(new Error('font failure'));
  const editor = editing(load); editor.prepareFont();
  const retry = editor.toolbar.querySelector('[data-action="retry-font"]');
  await vi.waitFor(() => expect(retry.hidden).toBe(false));
  expect(editor.draft.text).toBe('Правка пользователя');
  load.mockResolvedValue(undefined); editor.action({ target: retry });
  await vi.waitFor(() => expect(editor.draft.fontReady).toBe(true));
  expect(retry.hidden).toBe(true);
});
it('ignores an old failed request after the user selects another font', async () => {
  let fail;
  const editor = editing(vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue(undefined));
  editor.prepareFont(); editor.draft.font = 'Noto Sans'; editor.prepareFont();
  await vi.waitFor(() => expect(editor.draft.fontReady).toBe(true));
  fail(new Error('late failure')); await Promise.resolve(); await Promise.resolve();
  expect(editor.draft.font).toBe('Noto Sans'); expect(editor.message).not.toHaveBeenCalled();
});
it('prepares browser measurement from engine bytes and reuses successful faces', async () => {
  const create = vi.fn();
  vi.stubGlobal('FontFace', class { constructor(family, bytes, style) { create(family, bytes, style); } load() { return Promise.resolve(this); } });
  Object.defineProperty(document, 'fonts', { value: { add: vi.fn() }, configurable: true });
  const engine = { fonts: [0,1,2,3].map(i => new Uint8Array([i,1,2])), ensureFont: vi.fn().mockResolvedValue(undefined), faceIndex: (_, bold, italic) => Number(bold) + Number(italic) * 2 };
  await prepareBrowserFont(engine, 'Times New Roman'); await prepareBrowserFont(engine, 'Times New Roman');
  expect(create).toHaveBeenCalledTimes(4);
  expect(create.mock.calls.every(call => engine.fonts.includes(call[1]))).toBe(true);
});
