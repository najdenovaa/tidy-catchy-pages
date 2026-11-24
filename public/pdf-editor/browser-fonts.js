// Render and measure with the very same font bytes that PDFium will embed.
const faces = new Map();
export async function prepareBrowserFont(engine, family) {
  await engine.ensureFont(family);
  await Promise.all([false, true].flatMap(italic => [false, true].map(async bold => {
    const bytes = engine.fonts[engine.faceIndex(family, bold, italic)];
    if (!bytes) throw new Error('Данные шрифта не загружены.');
    const key = `${family}/${bold}/${italic}`;
    let cached = faces.get(key);
    if (!cached || cached.bytes !== bytes) {
      const entry = { bytes, promise: null };
      entry.promise = new FontFace(family, bytes, { weight: bold ? '700' : '400', style: italic ? 'italic' : 'normal' })
        .load().then(face => { document.fonts.add(face); })
        .catch(error => { if (faces.get(key) === entry) faces.delete(key); throw error; });
      faces.set(key, entry);
      cached = entry;
    }
    await cached.promise;
  })));
}
