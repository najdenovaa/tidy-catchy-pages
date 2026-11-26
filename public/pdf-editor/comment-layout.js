import { wrapText } from './layout.js';

export const noteColor = {
  line: '#7452ca', highlight: '#dabdff66', bubble: '#faf7ff', text: '#302255',
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
let measuring;

export function calloutLayout(pageWidth, pageHeight, note) {
  measuring ??= document.createElement('canvas').getContext('2d');
  const box = ({ x, y, w, h }) => ({ x: x * pageWidth, y: y * pageHeight, w: w * pageWidth, h: h * pageHeight });
  const targets = note.boxes.map(box);
  const target = targets[0];
  const padding = Math.min(7, pageWidth * .04, pageHeight * .05);
  const width = Math.min(164, pageWidth - 2 * padding);
  const font = '11px sans-serif';
  measuring.font = font;
  const lines = wrapText(note.text, Math.max(1, width - 2 * padding), text => measuring.measureText(text).width);
  const rows = Math.max(1, Math.min(4, Math.floor((pageHeight - 4 * padding) / 14)));
  const visible = lines.slice(0, rows);
  if (lines.length > rows) {
    let tail = visible.at(-1).trimEnd();
    while (tail && measuring.measureText(tail + '…').width > width - 2 * padding) tail = tail.slice(0, -1);
    visible[rows - 1] = tail + '…';
  }
  const height = Math.min(pageHeight - 2 * padding, 2 * padding + visible.length * 14);
  const preferredX = target.x + target.w + 22 + width <= pageWidth - padding
    ? target.x + target.w + 22 : target.x - width - 22;
  const x = clamp(note.bubble ? note.bubble[0] * pageWidth - width / 2 : preferredX, padding, pageWidth - padding - width);
  const positionedBeside = x + width <= target.x || x >= target.x + target.w;
  const preferredY = positionedBeside ? target.y : target.y + target.h + 24;
  const y = clamp(note.bubble ? note.bubble[1] * pageHeight - height / 2 : preferredY, padding, pageHeight - padding - height);
  const bubble = { x, y, w: width, h: height };
  const center = [x + width / 2, y + height / 2];
  const source = [clamp(center[0], target.x, target.x + target.w), clamp(center[1], target.y, target.y + target.h)];
  const near = [clamp(source[0], x, x + width), clamp(source[1], y, y + height)];
  const elbow = note.elbow
    ? [clamp(note.elbow[0] * pageWidth, padding, pageWidth - padding), clamp(note.elbow[1] * pageHeight, padding, pageHeight - padding)]
    : [(source[0] + near[0]) / 2, (source[1] + near[1]) / 2];
  const horizontal = Math.abs((elbow[0] - center[0]) / width) >= Math.abs((elbow[1] - center[1]) / height);
  const endPoint = horizontal
    ? [elbow[0] < center[0] ? x : x + width, clamp(elbow[1], y + padding, y + height - padding)]
    : [clamp(elbow[0], x + padding, x + width - padding), elbow[1] < center[1] ? y : y + height];
  return { targets, bubble, line: [source, elbow, endPoint], lines: visible, padding, font };
}

export function paintCallout(context, layout) {
  context.fillStyle = noteColor.highlight;
  for (const { x, y, w, h } of layout.targets) context.fillRect(x, y, w, h);
  context.strokeStyle = noteColor.line;
  context.lineWidth = 1.15;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();
  layout.line.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
  context.stroke();
  const { x, y, w, h } = layout.bubble;
  context.beginPath();
  context.roundRect(x, y, w, h, Math.min(6, w / 2, h / 2));
  context.fillStyle = noteColor.bubble;
  context.fill();
  context.stroke();
  context.fillStyle = noteColor.text;
  context.font = layout.font;
  context.textBaseline = 'top';
  context.save();
  context.clip();
  layout.lines.forEach((text, i) => context.fillText(text, x + layout.padding, y + layout.padding + i * 14, w - 2 * layout.padding));
  context.restore();
}
