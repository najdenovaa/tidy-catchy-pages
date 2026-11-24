import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PdfEngine, kinds } from '../../public/pdf-editor/pdf.js';
import { resizeImage } from '../../public/pdf-editor/gestures.js';

function documentWithImageClip() {
  const commands = 'q 55 225 123 72 re W n 120 0 0 80 60 220 cm /Image Do Q';
  const picture = 'f0253c'.repeat(30 * 20) + '>';
  const items = [
    '<</Type /Catalog /Pages 2 0 R>>',
    '<</Type /Pages /Kids [3 0 R] /Count 1>>',
    '<</Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R /Resources <</XObject <</Image 5 0 R>>>>>>',
    `<</Length ${commands.length}>>\nstream\n${commands}\nendstream`,
    `<</Type /XObject /Subtype /Image /Width 30 /Height 20 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${picture.length}>>\nstream\n${picture}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = items.map((item, index) => {
    const start = pdf.length;
    pdf += `${index + 1} 0 obj\n${item}\nendobj\n`;
    return String(start).padStart(10, '0') + ' 00000 n \n';
  });
  const start = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.join('')}trailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const root = new URL('../../public/pdf-editor/', import.meta.url);
const engine = await PdfEngine.initialize(await readFile(new URL('vendor/pdfium.wasm', root)), []);
engine.open(documentWithImageClip());

function area(preview) {
  const page = engine.render(0, 400, 400, true, preview);
  let count = 0;
  let left = Infinity;
  let top = Infinity;
  for (let i = 0; i < page.pixels.length; i += 4) {
    if (page.pixels[i] > 220 && page.pixels[i + 1] < 60) {
      count++;
      left = Math.min(left, i / 4 % page.width);
      top = Math.min(top, Math.floor(i / 4 / page.width));
    }
  }
  return { count, left, top, object: page.objects.find(item => item.kind === kinds.image) };
}

const original = area();
assert.ok(original.count > 8000);
const shift = { dx: .40, dy: .15 };
let preview = area({ indices: [], motion: { index: original.object.index, ...shift } });
assert.equal(preview.count, original.count, 'preview moves the clipping path with the image');
assert.equal(preview.left - original.left, 160);
assert.equal(preview.top - original.top, 60);
assert.equal(area().left, original.left, 'preview changes no placement');
engine.update(0, original.object, shift);
engine.open(engine.save());
const moved = area();
assert.equal(moved.count, original.count, 'moving and reopening does not crop the image');
assert.equal(moved.left, preview.left);

const smaller = resizeImage(moved.object, 'se', -.075, -.05, 400, 400);
assert.ok(Math.abs(smaller.widthRatio - .75) < .001);
preview = area({ indices: [], motion: { index: moved.object.index, ...smaller } });
engine.update(0, moved.object, smaller);
engine.open(engine.save());
const resized = area();
assert.ok(Math.abs(resized.object.w / moved.object.w - .75) < .001);
assert.ok(Math.abs(resized.object.h / moved.object.h - .75) < .001);
assert.ok(Math.abs(resized.count / moved.count - .75 ** 2) < .025);
assert.equal(resized.count, preview.count);

const larger = resizeImage(resized.object, 'nw', -.075, -.05, 400, 400);
engine.update(0, resized.object, larger);
engine.open(engine.save());
const enlarged = area();
assert.ok(Math.abs(enlarged.object.w - moved.object.w) < .001);
assert.ok(Math.abs(enlarged.object.h - moved.object.h) < .001);
assert.ok(Math.abs(enlarged.object.x + enlarged.object.w - resized.object.x - resized.object.w) < .001);
assert.ok(Math.abs(enlarged.object.y + enlarged.object.h - resized.object.y - resized.object.h) < .001);
engine.clear();
console.log('Clipped PDF image stays visible while moving, shrinking and enlarging, including after saving and reopening.');
