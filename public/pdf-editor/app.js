import { prepareBrowserFont } from './browser-fonts.js';
import { officeAliases, fontLabel, installOfficeFonts, restoreOfficeFonts } from './office-fonts.js';
import { createSessionStore, validSession } from './local-session.js';
import { PdfEngine, kinds } from './pdf.js';
import { icon } from './icons.js';
import { coreFonts, detectTables, tableFromRegion } from './layout.js';
import { InlineEditor } from './inline.js';
import { Comments } from './comments.js';
import { prepareOCR, recognizePage } from './scan.js';
import { bindPinch, containImage, resizeImage } from './gestures.js';
import { fileMimes, inputFormat, officeToPdf, pdfToOffice } from './convert.js';
import { readArtwork } from './stamps.js';
import { makeQr } from './qr.js';
import { shapes, shapeIcon } from './shapes.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const paper = $('paper');
const canvas = $('document-canvas');
const overlay = $('overlay');
const areaActions = $('area-actions');
const pageMenu = $('page-menu');
const inspector = $('inspector');
const thumbs = $('thumbnails');
const objectsPanel = $('objects');
const pageSidebar = document.querySelector('.pages');
const propertiesSidebar = document.querySelector('.properties');
const mobile = matchMedia('(max-width: 920px)');
const demoName = 'Коммерческое предложение.pdf';
const maxFileSize = 65 * 1024 * 1024;
const stampFiles = new Map();
const state = {
  engine: null, name: '', demo: false, index: 0, selected: null,
  mode: 'select', filter: 'all', expanded: false, zoom: null, page: null, tables: [], region: null, area: null, areaDrag: null,
  history: [], revision: 0, saved: null,
  busy: false, hover: null, drag: null, suppressClickUntil: 0, panel: null, imageTarget: null,
};
const sessionStore = createSessionStore();
let sessionReady = false;
let saveTimer, firstPendingSave = 0, sessionGeneration = 0;
function sessionStatus(message, error = false) {
  $('session-status').textContent = message;
  $('status-detail').classList.toggle('save-error', error);
}
function scheduleSession() {
  if (!sessionReady || !state.history.length) return;
  firstPendingSave ||= Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, Math.min(300, Math.max(0, 1500 - (Date.now() - firstPendingSave))));
}
async function saveSession() {
  clearTimeout(saveTimer);
  firstPendingSave = 0;
  if (!sessionReady || !state.history.length) return;
  const generation = ++sessionGeneration;
  const entry = state.history[state.revision];
  const snapshot = {
    version: 1, name: state.name, bytes: entry.bytes, page: state.index, zoom: state.zoom,
    saved: entry.bytes === state.saved, updatedAt: Date.now(),
    draft: editor.draft?.dirty ? structuredClone(editor.draft) : null,
  };
  sessionStatus('Сохраняем сессию…');
  try {
    await sessionStore.write(snapshot);
    if (generation === sessionGeneration) sessionStatus('Сессия сохранена в этом браузере');
  } catch {
    if (generation === sessionGeneration) sessionStatus('Сессия не сохранена. Скачайте PDF', true);
  }
}
const labels = {
  [kinds.text]: ['Текст', 'text'],
  [kinds.path]: ['Векторная фигура', 'rectangle'],
  [kinds.image]: ['Изображение', 'image'],
  [kinds.shading]: ['Градиент', 'rectangle'],
  [kinds.group]: ['Группа объектов', 'group'],
};
const mainControls = [
  'export', 'select', 'select-area', 'add-text', 'add-image', 'add-shape', 'add-page', 'rotate-page',
  'duplicate-page', 'add-table', 'watermark', 'sign', 'comment', 'marker', 'ocr', 'clipboard', 'export-docx', 'export-xlsx', 'zoom-out', 'zoom-in', 'fit', 'fit-icon',
];

document.querySelectorAll('[data-icon]').forEach(element => {
  element.innerHTML = icon(element.dataset.icon);
});
for (const [id, label] of Object.entries({ open: 'Открыть файл', demo: 'Пример', export: 'Скачать PDF', 'add-text': 'Текст', 'add-image': 'Изображение', 'add-shape': 'Фигура', select: 'Выбор' })) {
  $(id).setAttribute('aria-label', label);
}

let noticeTimer;
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, error ? 5500 : 3000);
}

const editor = new InlineEditor({
  changed: scheduleSession,
  scanRect: cover => state.engine.page(state.index, page => state.engine.displayRect(page, cover.raw)),
  layer: $('editor-layer'), toolbar: $('formatbar'), stylebar: $('table-formatbar'), getPage: () => state.page,
  render: () => renderSafely(), message: notice, loadFont: family => prepareBrowserFont(state.engine, family),
  makeRotationGrip: rotationGrip,
  objectAction: angle => {
    const draft = editor.draft;
    if (angle === null) {
      editor.cancel();
      if (draft.indices.length) mutate(engine => engine.removeObjects(state.index, draft.indices), { message: 'Объект удалён' });
      return;
    }
    const object = finishForRotation();
    if (object) rotateObject(object, angle);
  },
  commit: plan => {
    const oldHeight = state.page.pageHeight;
    const ok = mutate(engine => plan.mode === 'text' ? engine.writeBlock(state.index, plan) : engine.writeTable(state.index, plan), { inline: true });
    if (ok) notice(state.page.pageHeight > oldHeight + 1
      ? 'Изменения применены. Страница удлинена, чтобы вместить содержимое.'
      : 'Изменения применены');
    return ok;
  },
});

const comments = new Comments({
  layer: $('annotation-layer'), panel: $('comments-panel'), container: $('properties-body'),
  toggle: $('comments-toggle'), getPage: () => state.page,
  show: () => { if (mobile.matches) setPanel('properties'); },
  revealPage: () => { if (mobile.matches) setPanel(null); },
  save: (draft, text) => {
    let index = draft.index;
    const ok = mutate(engine => {
      if (index === undefined) index = engine.addNote(state.index, draft.anchor, text);
      else engine.editNote(state.index, index, text);
    }, { message: 'Комментарий сохранён' });
    return ok ? index : null;
  },
  move: (index, position) => {
    const note = state.page?.notes.find(note => note.index === index);
    if (!note) return false;
    return mutate(engine => engine.editNote(state.index, index, note.text, position), { message: 'Комментарий перемещён' });
  },
  remove: index => mutate(engine => engine.removeNote(state.index, index), { message: 'Комментарий удалён' }),
});

function report(error) {
  notice(error.message || 'Операцию не удалось выполнить.', true);
}

function status(message) {
  $('status').textContent = message;
}

function syncControls() {
  const ready = !!state.engine?.count && !state.busy;
  for (const id of mainControls) $(id).disabled = !ready;
  $('fonts-open').disabled = state.busy || !state.engine;
  $('open').disabled = state.busy || !state.engine || !sessionReady;
  $('upload-document').disabled = $('open').disabled;
  $('demo').disabled = state.busy || !state.engine;
  $('convert').disabled = state.busy || !state.engine;
  $('comments-toggle').disabled = !ready;
  $('add-files').disabled = !ready;
  $('pick-office').disabled = state.busy || !state.engine;
  $('undo').disabled = !ready || state.revision === 0;
  $('redo').disabled = !ready || state.revision >= state.history.length - 1;
  const count = state.engine?.count ?? 0;
  for (const id of ['prev-page', 'move-up']) $(id).disabled = !ready || state.index === 0;
  for (const id of ['next-page', 'move-down']) $(id).disabled = !ready || state.index >= count - 1;
  $('delete-page').disabled = !ready || count <= 1;
  $('page-position').textContent = count ? `${state.index + 1} из ${count}` : '—';
  $('page-count').textContent = count || '';
  const changed = state.history[state.revision]?.bytes !== state.saved || editor.draft?.dirty;
  $('document-meta').textContent = count ? changed ? 'Есть несохранённые правки' : state.demo ? 'Демонстрационный документ' : 'Документ открыт' : 'Документ не открыт';
}

function paint(target, view) {
  target.width = view.width;
  target.height = view.height;
  target.getContext('2d', { alpha: false }).putImageData(new ImageData(view.pixels, view.width, view.height), 0, 0);
}

function renderPage() {
  if (!state.engine?.count) return;
  const dimensions = state.engine.page(state.index, page => state.engine.dimensions(page));
  const css = getComputedStyle(stage);
  const availableWidth = Math.max(90, stage.clientWidth - 2 * parseFloat(css.paddingLeft) - 2);
  const availableHeight = Math.max(90, stage.clientHeight - 2 * parseFloat(css.paddingTop) - 2);
  const fit = Math.min(1.35, availableWidth / dimensions.width, availableHeight / dimensions.height);
  const scale = state.zoom ?? fit;
  const width = dimensions.width * scale;
  const height = dimensions.height * scale;
  const dpr = Math.min(devicePixelRatio || 1, 2, 2800 / Math.max(width, height));
  const drag = state.drag;
  const preview = state.turn
    ? { indices: [], turn: state.turn }
    : imageLike(drag?.object)
    ? { indices: [], motion: { index: drag.object.index, dx: drag.dx, dy: drag.dy, widthRatio: drag.widthRatio, heightRatio: drag.heightRatio } }
    : editor.preview();
  const page = state.engine.render(state.index, width * dpr, height * dpr, true, preview);
  state.page = page;
  state.tables = detectTables(page);
  if (state.selected !== null && !getSelected()) state.selected = null;
  paint(canvas, page);
  paper.style.width = `${width}px`;
  paper.style.height = `${height}px`;
  paper.hidden = false;
  $('welcome').hidden = true;
  $('fit').textContent = `${Math.round(scale * 100)}%`;
  $('fit').dataset.scale = scale;
  renderSelection();
  editor.position();
  comments.renderMarkers();
}

function renderSafely() {
  try {
    renderPage();
  } catch (error) {
    paper.hidden = true;
    $('welcome').hidden = false;
    $('welcome').querySelector('p').textContent = 'Не удалось отобразить страницу.';
    report(error);
  }
}

const thumbnailObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const element = entry.target;
    thumbnailObserver.unobserve(element);
    const index = Number(element.dataset.page);
    try {
      paint(element.querySelector('canvas'), state.engine.render(index, 250, 254));
    } catch {
      element.querySelector('canvas').hidden = true;
    }
  }
}, { root: thumbs, rootMargin: '145px' });

function renderThumbnails(rebuild) {
  if (rebuild) {
    finishPageDrag();
    const scroll = thumbs.scrollTop;
    thumbnailObserver.disconnect();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < state.engine.count; index++) {
      const button = document.createElement('button');
      button.className = 'thumb';
      button.draggable = true;
      button.dataset.page = index;
      button.setAttribute('aria-label', `Страница ${index + 1}`);
      button.title = 'Перетащите для изменения порядка страниц';
      button.innerHTML = `<span class="thumb-preview"><canvas aria-hidden="true"></canvas></span><span>${index + 1}</span>`;
      fragment.append(button);
    }
    thumbs.replaceChildren(fragment);
    thumbs.scrollTop = scroll;
    thumbs.querySelectorAll('.thumb').forEach(button => thumbnailObserver.observe(button));
  }
  thumbs.querySelector('.thumb.active')?.classList.remove('active');
  thumbs.querySelector('[aria-current]')?.removeAttribute('aria-current');
  const current = thumbs.children[state.index];
  if (current) {
    current.classList.add('active');
    current.setAttribute('aria-current', 'page');
    current.scrollIntoView({ block: 'nearest' });
  }
}

function getSelected() {
  return state.page?.objects.find(object => object.index === state.selected);
}

function html(text) {
  return String(text ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

const imageLike = object => object?.kind === kinds.image || object?.clipboardImage;

function objectName(object) {
  if (object.clipboardImage) return 'Изображение';
  if (object.watermark) return object.text ? 'Водяной знак · ' + object.text : 'Водяной знак · Изображение';
  if (object.tableIndex !== undefined) return `Таблица · ${object.rows.length} × ${object.widths.length}`;
  if (object.tableSpec) return `Таблица · ${object.tableSpec.rows.length} × ${object.tableSpec.widths.length}`;
  return object.text?.trim() || labels[object.kind][0];
}

function renderObjects() {
  const hidden = tableMembers();
  const objects = (state.page?.objects ?? []).filter(object => !hidden.has(object.index) && !(object.blockId && object.kind === kinds.path)
    && (!object.tableId || object.tableSpec))
    .concat(state.tables.map((table, tableIndex) => ({ ...table, y: table.y / state.page.pageHeight, x: table.x / state.page.pageWidth, tableIndex })));
  $('object-count').textContent = objects.length || '';
  const filtered = objects.filter(object => state.filter === 'all'
    || (state.filter === 'graphics' ? object.kind !== kinds.text || object.watermark : !object.watermark && object.kind === Number(state.filter)));
  filtered.sort((a, b) => a.y - b.y || a.x - b.x);
  const visible = state.expanded ? filtered : filtered.slice(0, 10);
  const selected = filtered.find(object => object.index === state.selected);
  if (selected && !visible.includes(selected)) visible.push(selected);
  if (!filtered.length) {
    objectsPanel.innerHTML = '<p class="object-empty">Здесь пока нет объектов.</p>';
    return;
  }
  objectsPanel.innerHTML = visible.map(object => {
    const active = object.index === state.selected;
    const name = html(objectName(object));
    const target = object.tableIndex === undefined ? `data-object="${object.index}"` : `data-table="${object.tableIndex}"`;
    return `<button type="button" class="object${active ? ' active' : ''}" ${target} aria-pressed="${active}" title="${name}">
      <span class="object-icon">${icon(object.tableIndex !== undefined || object.tableSpec ? 'table' : labels[object.kind][1])}</span><span class="object-name">${name}</span></button>`;
  }).join('') + (filtered.length > visible.length || state.expanded && filtered.length > 10
    ? `<button type="button" class="button ghost object-more" data-more>${state.expanded ? 'Свернуть список' : `Показать все (${filtered.length})`}</button>` : '');
}

function numeric(name, label, value, min, max) {
  return `<label>${label}<input type="number" name="${name}" step="any" min="${min}" max="${max}" value="${Math.round(value * 100) / 100}" required></label>`;
}

function colorInput(color, label) {
  if (!color) return '';
  const hex = color.slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('');
  return `<label>${label}<input type="color" name="color" value="#${hex}"></label>`;
}

function renderInspector() {
  const object = getSelected();
  if (!object) {
    inspector.innerHTML = `<div class="inspector-empty">
      <span class="empty-icon">${icon('cursor')}</span><strong>Выберите объект</strong>
      <p>Нажмите на текст или таблицу, чтобы править на странице. Свойства графики откроются здесь.</p></div>`;
    return;
  }
  const { pageWidth: w, pageHeight: h } = state.page;
  const [label, iconName] = object.tableId ? ['Таблица', 'table'] : object.watermark ? ['Водяной знак', 'watermark'] : imageLike(object) ? labels[kinds.image] : labels[object.kind];
  const table = object.tableId && state.tables.find(entry => entry.indices.includes(object.index));
  const isText = object.kind === kinds.text && !object.watermark && !object.tableId;
  const canEditDimensions = !isText && !object.tableId;
  const canResize = canEditDimensions && !object.watermark && object.w * w >= 0.1 && object.h * h >= 0.1;
  const position = numeric('left', 'Слева, пт', object.x * w, -w * 2, w * 2)
    + numeric('top', 'Сверху, пт', object.y * h, -h * 2, h * 2);
  const sizes = canResize
    ? numeric('width', 'Ширина, пт', object.w * w, 0.1, w * 3) + numeric('height', 'Высота, пт', object.h * h, 0.1, h * 3)
    : '';
  inspector.innerHTML = `<form class="edit-form" id="edit-form">
    <div class="edit-title"><span class="object-icon">${icon(iconName)}</span><strong>${label}</strong>
      <button type="button" class="icon-button danger-icon" aria-label="Удалить объект" title="Удалить объект" data-remove>${icon('trash')}</button></div>
    ${canEditDimensions ? `<div class="field-row">${position}</div>` : ''}
    ${sizes ? `<div class="field-row">${sizes}</div>` : ''}
    ${canEditDimensions ? colorInput(object.color, object.stroke ? 'Цвет контура' : 'Цвет') : ''}
    <div class="object-rotation">
      <button type="button" class="icon-button outlined" aria-label="Повернуть влево на 90°" title="Повернуть влево на 90°" data-turn="-90">${icon('rotate')}</button>
      <button type="button" class="icon-button outlined" aria-label="Повернуть вправо на 90°" title="Повернуть вправо на 90°" data-turn="90">${icon('rotate')}</button>
      ${numeric('turn', 'Поворот, °', 0, -360, 360)}
      <button type="button" class="button outlined" data-turn="custom">Повернуть</button>
    </div>
    ${isText && object.horizontal ? '<button type="button" class="button outlined" data-inline>Редактировать на странице</button>' : ''}
    ${isText && !object.horizontal ? '<p class="tool-note">Для правки верните текст в горизонтальное положение.</p>' : ''}
    ${table ? '<button type="button" class="button outlined" data-inline-table>Редактировать таблицу</button>' : ''}
    ${object.kind === kinds.image && !object.watermark ? '<button type="button" class="button outlined" data-replace>Заменить изображение</button>' : ''}
    ${canEditDimensions ? '<button type="submit" class="button primary">Применить</button>' : ''}</form>`;
}

function putBox(box, selected, { dx = 0, dy = 0, widthRatio = 1, heightRatio = 1 } = {}) {
  const element = document.createElement('span');
  element.className = `selection-box${selected ? ' selected' : ''}`;
  Object.assign(element.style, {
    left: `${(box.x + dx) * 100}%`, top: `${(box.y + dy) * 100}%`,
    width: `max(3px, ${box.w * widthRatio * 100}%)`, height: `max(3px, ${box.h * heightRatio * 100}%)`,
  });
  if (selected && state.turn) element.style.transform = `rotate(${state.turn.degrees}deg)`;
  if (selected) {
    const grip = rotationGrip();
    grip.classList.toggle('below', box.y * overlay.clientHeight < 34);
    element.append(grip);
  }
  if (selected && imageLike(box)) element.classList.add('image-selected');
  if (selected && imageLike(box) && !state.drag) {
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'selection-grip';
    if (box.y < .075) grip.style.inset = '2px auto auto 19px';
    grip.setAttribute('aria-label', 'Переместить изображение');
    grip.title = 'Перетащите изображение';
    grip.innerHTML = icon('move');
    element.append(grip);
    const actions = document.createElement('span');
    actions.className = 'image-actions';
    if (box.y < .075) actions.classList.add('inset');
    actions.innerHTML = `<button type="button" class="icon-button" data-image-action="turn" title="Повернуть выделенное вправо" aria-label="Повернуть выделенное вправо">${icon('rotate')}</button>
      <button type="button" class="icon-button danger-icon" data-image-action="delete" title="Удалить выделенное" aria-label="Удалить выделенное">${icon('trash')}</button>`;
    element.append(actions);
    const corners = { nw: 'левый верхний', ne: 'правый верхний', sw: 'левый нижний', se: 'правый нижний' };
    for (const [direction, name] of Object.entries(corners)) {
      const resize = document.createElement('button');
      resize.type = 'button';
      resize.className = 'resize-grip';
      resize.dataset.corner = direction;
      resize.title = 'Потяните за угол, чтобы изменить размер';
      resize.setAttribute('aria-label', 'Изменить размер · ' + name + ' угол');
      element.append(resize);
    }
  }
  overlay.append(element);
}

function renderSelection() {
  overlay.replaceChildren();
  areaActions.hidden = true;
  if (editor.draft) return;
  if (state.mode === 'paste' && state.pendingPaste?.type === 'area' && state.pastePoint) {
    const image = state.pendingPaste.image;
    const target = bitmapPosition(state.pastePoint, image);
    const ghost = document.createElement('img');
    ghost.className = 'area-paste-preview';
    ghost.alt = '';
    ghost.src = image.preview;
    Object.assign(ghost.style, {
      left: `${target.x / state.page.pageWidth * 100}%`, top: `${target.y / state.page.pageHeight * 100}%`,
      width: `${target.width / state.page.pageWidth * 100}%`, height: `${target.height / state.page.pageHeight * 100}%`,
    });
    overlay.append(ghost);
  }
  const area = state.areaDrag ? areaBounds(state.areaDrag, state.areaDrag.end) : state.area;
  if (area) {
    const box = document.createElement('div');
    box.className = 'area-box';
    Object.assign(box.style, { left: `${area.x * 100}%`, top: `${area.y * 100}%`,
      width: `${area.w * 100}%`, height: `${area.h * 100}%` });
    overlay.append(box);
    if (!state.areaDrag) {
      areaActions.style.left = `clamp(34px, ${(area.x + area.w) * 100}%, 100%)`;
      areaActions.style.top = `clamp(0px, ${(area.y + area.h) * 100}%, calc(100% - 28px))`;
      areaActions.hidden = false;
    }
  }
  if (state.region) {
    const { x, y, endX, endY } = state.region;
    putBox({ x: Math.min(x, endX), y: Math.min(y, endY), w: Math.abs(x - endX), h: Math.abs(y - endY) }, false);
  }
  if (state.mode !== 'select' || area) return;
  const selected = getSelected();
  if (state.hover && state.hover.index !== selected?.index && !state.drag && !state.turn) putBox(state.hover, false);
  if (selected) putBox(state.turn?.box ?? (state.drag ? selected : objectBounds(objectGroup(selected), selected)), true, state.drag ?? undefined);
}

function setMode(mode) {
  clearArea();
  clearCommentDrag();
  state.mode = mode;
  state.hover = null;
  overlay.style.cursor = '';
  overlay.dataset.mode = mode;
  $('marker').setAttribute('aria-pressed', mode === 'marker');
  document.querySelectorAll('[data-mode]').forEach(button => {
    if (button === overlay) return;
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
  if (mode !== 'select') {
    setPanel(null);
    status({
      area: 'Протяните рамку по нужной части страницы',
      text: 'Нажмите на страницу, чтобы добавить текст',
      shape: 'Нажмите на страницу, чтобы разместить фигуру',
      image: 'Нажмите на страницу, куда нужно вставить изображение',
      qr: 'Нажмите на страницу, чтобы разместить QR-код',
      paste: 'Нажмите на страницу, куда вставить содержимое буфера',
      comment: 'Протяните по тексту или нажмите на слово либо объект',
      marker: state.markerColor ? 'Нажимайте на слова, чтобы выделить их цветом' : 'Нажимайте на слова, чтобы снять выделение',
      stamp: 'Нажмите на страницу, чтобы разместить выбранный элемент',
      table: 'Нажмите для вставки таблицы или обведите существующую рамкой',
    }[mode]);
  } else {
    status(state.engine?.count ? 'Готово к редактированию' : 'Откройте PDF');
  }
  renderSelection();
}

function setPanel(panel) {
  state.panel = panel;
  pageSidebar.classList.toggle('visible', panel === 'pages');
  propertiesSidebar.classList.toggle('visible', panel === 'properties');
  $('pages-toggle').setAttribute('aria-expanded', panel === 'pages');
  $('properties-toggle').setAttribute('aria-expanded', panel === 'properties');
  $('backdrop').hidden = !panel || !mobile.matches;
}

function selectObject(index, { showPanel = false } = {}) {
  if (index !== null && comments.visible) comments.hide();
  state.selected = index;
  state.hover = null;
  renderInspector();
  renderObjects();
  renderSelection();
  overlay.classList.toggle('movable', index !== null);
  if (showPanel && mobile.matches && index !== null && !imageLike(getSelected())) setPanel('properties');
}

function refresh(rebuild = false) {
  state.hover = null;
  renderSafely();
  renderThumbnails(rebuild);
  renderObjects();
  renderInspector();
  overlay.classList.toggle('movable', state.selected !== null);
  syncControls();
  comments.render();
}

function setPage(index) {
  if (!state.engine?.count || index < 0 || index >= state.engine.count || state.busy || !editor.finish()) return;
  comments.reset();
  clearCommentDrag();
  clearArea();
  state.index = index;
  state.history[state.revision].page = index;
  state.selected = null;
  state.expanded = false;
  stage.scrollTo(0, 0);
  refresh();
  scheduleSession();
}

function pruneHistory() {
  let total = state.history.reduce((acc, entry) => acc + entry.bytes.byteLength, 0);
  while (state.history.length > 2 && (total > 112 * 1024 * 1024 || state.history.length > 13)) {
    total -= state.history.shift().bytes.byteLength;
    state.revision--;
  }
}

function mutate(change, { page = state.index, message, select = false, inline = false } = {}) {
  if (!state.engine?.count || state.busy || !inline && !editor.finish()) return false;
  const before = state.history[state.revision];
  let selection;
  try {
    selection = change(state.engine);
    const bytes = state.engine.save();
    state.engine.open(bytes);
    state.history.splice(state.revision + 1);
    if (state.index !== page) {
      comments.reset();
      clearArea();
    }
    state.index = Math.min(page, state.engine.count - 1);
    state.history.push({ bytes, page: state.index });
    state.revision++;
    pruneHistory();
  } catch (error) {
    state.engine.open(before.bytes);
    refresh(true);
    report(error);
    return false;
  }
  state.selected = select ? selection : null;
  refresh(true);
  if (select && mobile.matches && !imageLike(getSelected())) setPanel('properties');
  if (message) notice(message);
  void saveSession();
  return true;
}

function restoreHistory(delta) {
  editor.cancel();
  const revision = state.revision + delta;
  if (state.busy || revision < 0 || revision >= state.history.length) return;
  const entry = state.history[revision];
  try {
    state.engine.open(entry.bytes);
    comments.reset();
    clearArea();
    state.revision = revision;
    state.index = entry.page;
    state.selected = null;
    refresh(true);
    notice(delta < 0 ? 'Действие отменено' : 'Действие повторено');
    void saveSession();
  } catch (error) {
    report(error);
  }
}

function atPosition(event) {
  const rectangle = overlay.getBoundingClientRect();
  return { x: (event.clientX - rectangle.left) / rectangle.width, y: (event.clientY - rectangle.top) / rectangle.height };
}

function tableMembers() {
  return new Set(state.tables.flatMap(table => table.indices));
}

function tableAt({ x, y }) {
  const left = x * state.page.pageWidth, top = y * state.page.pageHeight;
  return state.tables.find(table => left >= table.x - 2 && left <= table.x + table.w + 2
    && top >= table.y - 2 && top <= table.y + table.h + 2);
}

function editText(object, point) {
  if (!object?.horizontal || object.tableId) {
    if (object) selectObject(object.index, { showPanel: true });
    return;
  }
  setMode('select');
  setPanel(null);
  selectObject(null);
  editor.selectText(object, tableMembers(), point && { x: point.x * state.page.pageWidth, y: point.y * state.page.pageHeight });
}

function editTable(table, point) {
  setMode('select');
  setPanel(null);
  selectObject(null);
  editor.openTable(table, point && { x: point.x * state.page.pageWidth, y: point.y * state.page.pageHeight });
}

function objectAt({ x, y }, includeLarge = false) {
  const paddingX = 3 / overlay.clientWidth;
  const paddingY = 3 / overlay.clientHeight;
  const candidates = (state.page?.objects ?? []).filter(object => !object.watermark && !(object.blockId && object.kind === kinds.path) && (includeLarge || object.w * object.h < 0.9)
    && x >= object.x - paddingX && x <= object.x + object.w + paddingX
    && y >= object.y - paddingY && y <= object.y + object.h + paddingY);
  const foreground = candidates.findLast(object => object.kind === kinds.text);
  return foreground ?? candidates.at(-1);
}

function addComment(target, point) {
  const page = state.page;
  const anchor = point && target.kind === kinds.text
    ? state.engine.wordAt(state.index, point.x, point.y, target.index)
    : null;
  const note = anchor ?? state.engine.page(state.index, handle => {
    const { x, y, w, h } = target;
    const [x0, y0] = state.engine.documentPoint(handle, x, y);
    const [x1, y1] = state.engine.documentPoint(handle, x + w, y + h);
    return { raw: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)],
      label: target.text?.trim().slice(0, 100) || (target.kind ? labels[target.kind][0] : target.label ?? 'Таблица') };
  });
  beginComment(note);
}

function beginComment(note) {
  const { boxes } = state.engine.page(state.index, handle => state.engine.commentPosition(handle, note));
  setMode('select');
  selectObject(null);
  comments.begin(note, boxes);
}

function clearCommentDrag() {
  if (!state.commentDrag) return;
  cancelAnimationFrame(state.commentDrag.frame);
  state.commentDrag = null;
  comments.previewSelection(null);
}

function numericInput(form, name, defaultValue) {
  return form.elements.namedItem(name)?.valueAsNumber ?? defaultValue;
}

function applyProperties(event) {
  event.preventDefault();
  const form = event.target;
  const object = getSelected();
  if (!object) return;
  const { pageWidth: w, pageHeight: h } = state.page;
  const color = form.elements.namedItem('color')?.value;
  const dx = numericInput(form, 'left', object.x * w) / w - object.x;
  const dy = numericInput(form, 'top', object.y * h) / h - object.y;
  const width = form.elements.namedItem('width');
  const height = form.elements.namedItem('height');
  const values = {
    dx: Math.abs(dx * w) < 0.02 ? 0 : dx,
    dy: Math.abs(dy * h) < 0.02 ? 0 : dy,
    widthRatio: width && Math.abs(width.valueAsNumber - object.w * w) > 0.02 ? width.valueAsNumber / (object.w * w) : 1,
    heightRatio: height && Math.abs(height.valueAsNumber - object.h * h) > 0.02 ? height.valueAsNumber / (object.h * h) : 1,
    color: color ? [...color.slice(1).match(/../g).map(value => parseInt(value, 16)), object.color[3]] : null,
  };
  if (imageLike(object)) {
    if (object.w * values.widthRatio > 1) values.widthRatio = 1 / object.w;
    if (object.h * values.heightRatio > 1) values.heightRatio = 1 / object.h;
    const resized = { ...object, w: object.w * values.widthRatio, h: object.h * values.heightRatio };
    Object.assign(values, containImage(resized, values.dx, values.dy));
  }
  mutate(engine => engine.update(state.index, object, values), { select: true, message: 'Изменения применены' });
}

function removeSelected() {
  const object = getSelected();
  if (object) mutate(engine => engine.removeObjects(state.index, objectGroup(object).map(item => item.index)), { message: 'Объект удалён' });
}

function objectGroup(object) {
  if (object.tableId) return state.page.objects.filter(item => item.tableId === object.tableId);
  return object.blockId ? state.page.objects.filter(item => item.blockId === object.blockId) : [object];
}

function objectBounds(items, object) {
  const x = Math.min(...items.map(item => item.x)), y = Math.min(...items.map(item => item.y));
  const w = Math.max(...items.map(item => item.x + item.w)) - x;
  const h = Math.max(...items.map(item => item.y + item.h)) - y;
  return { ...object, x, y, w, h };
}

function rotationGrip() {
  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'rotation-grip';
  grip.title = 'Перетащите для поворота. Shift — шаг 15°.';
  grip.setAttribute('aria-label', 'Поворот объекта перетаскиванием');
  grip.innerHTML = icon('rotate');
  return grip;
}

function finishForRotation() {
  const draft = editor.draft;
  if (!draft) return getSelected();
  if (draft.mode === 'table' && !state.page.objects.some(item => item.tableId === draft.id)) draft.dirty = true;
  if (!editor.finish()) return null;
  return state.page.objects.find(item => (item.kind === kinds.text && item.blockId === draft.id)
    || (item.tableSpec && item.tableId === draft.id))
    ?? (!draft.dirty && state.page.objects.find(item => item.kind === kinds.text && draft.indices.includes(item.index)));
}

const boxCenter = box => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

function rotateObject(object, degrees) {
  if (!Number.isFinite(degrees) || degrees % 360 === 0) return;
  const items = objectGroup(object);
  const center = boxCenter(objectBounds(items, object));
  return mutate(engine => engine.rotateObjects(state.index, items, center, degrees, object.index), { select: true, message: 'Объект повёрнут' });
}

function updateZoom(direction) {
  state.zoom = direction ? Math.min(6, Math.max(0.12, Number($('fit').dataset.scale) * 1.22 ** direction)) : null;
  renderSafely();
  scheduleSession();
}

function download(bytes, name, format) {
  const url = URL.createObjectURL(new Blob([bytes], { type: fileMimes[format] }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function exportFile() {
  if (!state.engine?.count || state.busy || !editor.finish()) return;
  const bytes = state.history[state.revision].bytes;
  download(bytes, state.name.replace(/\.pdf$/i, '') + ' — редакция.pdf', 'pdf');
  state.saved = bytes;
  syncControls();
  notice('PDF подготовлен к скачиванию');
  void saveSession();
}

async function exportOffice(format) {
  if (!state.engine?.count || state.busy || !editor.finish()) return;
  state.busy = true;
  $('convert-status').textContent = 'Готовим файл…';
  syncControls();
  try {
    const bytes = await pdfToOffice(state.engine, format);
    download(bytes, state.name.replace(/\.pdf$/i, '') + '.' + format, format);
    $('convert-status').textContent = format.toUpperCase() + ' подготовлен к скачиванию.';
  } catch (error) {
    $('convert-status').textContent = error.message || 'Не удалось преобразовать PDF.';
  } finally {
    state.busy = false;
    syncControls();
  }
}

function confirmOpen() {
  return editor.finish() && (!state.history.length || state.history[state.revision].bytes === state.saved
    || confirm('Открыть другой документ? Нескачанные изменения будут потеряны.'));
}

function loadDocument(bytes, name, demo) {
  state.engine.open(bytes);
  comments.reset();
  comments.hide();
  state.name = name;
  state.demo = demo;
  state.history = [{ bytes, page: 0 }];
  state.revision = 0;
  state.saved = bytes;
  state.index = 0;
  state.selected = null;
  state.expanded = false;
  state.zoom = null;
  state.filter = 'all';
  state.page = null;
  state.tables = [];
  $('filename').textContent = name;
  $('filename').title = name;
  setFilter('all');
  setMode('select');
  setPanel(null);
  stage.scrollTo(0, 0);
  refresh(true);
  void saveSession();
}

async function readFilePdf(file) {
  if (file.size > maxFileSize) throw new Error('Выберите файл размером до 65 МБ.');
  const format = inputFormat(file.name) ?? Object.keys(fileMimes).find(key => fileMimes[key] === file.type);
  if (format === 'png' || /\.(png|jpe?g)$/i.test(file.name) || /^image\/(png|jpeg)$/i.test(file.type)) {
    return openImageBytes(file);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (format === 'pdf' || new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-') return bytes;
  if (format === 'docx' || format === 'xlsx') return officeToPdf(state.engine, bytes, format);
  throw new Error('Откройте файл PDF, PNG, JPEG, DOCX или XLSX.');
}

async function openFiles(files, append = false, fromDialog = false) {
  if (state.busy || !state.engine || !files.length || !editor.finish()) return;
  const insertAt = append && state.engine.count ? (fromDialog ? state.engine.count : state.index + 1) : null;
  let bundle, source;
  state.busy = true;
  syncControls();
  try {
    if (files.length > 1 || insertAt !== null) {
      bundle = state.engine.temporary();
      bundle.createDocument();
      source = state.engine.temporary();
    }
    let bytes;
    for (const [index, file] of files.entries()) {
      const loading = files.length === 1 ? 'Открываем файл…' : `Обрабатываем файлы: ${index + 1} из ${files.length}…`;
      status(loading);
      if (fromDialog) $('convert-status').textContent = loading;
      try {
        bytes = await readFilePdf(file);
        if (bundle) {
          source.open(bytes);
          bundle.appendDocument(source);
          source.clear();
        }
      } catch (error) {
        throw new Error(file.name + ' · ' + (error.message || 'Не удалось прочитать файл.'));
      }
    }
    if (insertAt !== null) {
      state.busy = false;
      if (!mutate(engine => engine.appendDocument(bundle, insertAt), { page: insertAt, message: `Добавлено страниц: ${bundle.count}` })) {
        if (fromDialog) $('convert-status').textContent = 'Не удалось добавить страницы.';
        return;
      }
    } else {
      const name = bundle ? 'Сборка PDF.pdf' : files[0].name.replace(/\.[^.]+$/, '') + '.pdf';
      loadDocument(bundle ? bundle.save() : bytes, name, false);
      if (bundle) notice(`Собрано страниц: ${bundle.count}`);
      else if (!/\.pdf$/i.test(files[0].name)) notice('Документ преобразован в PDF');
    }
    if (fromDialog) $('convert-dialog').close();
  } catch (error) {
    if (fromDialog) $('convert-status').textContent = error.message;
    else report(error);
  } finally {
    bundle?.clear();
    source?.clear();
    state.busy = false;
    status(state.engine.count ? 'Готово к редактированию' : 'Откройте файл');
    syncControls();
  }
}

async function openImageBytes(file) {
  const data = await readArtwork(file);
  const target = state.engine.temporary();
  try {
    target.createDocument();
    const width = Math.min(595.28, 1450 * data.ratio);
    const height = width / data.ratio;
    target.addPage(0, width, height);
    target.edit(0, page => target.placeImage(page, { ...data, x: 0, y: 0, width, height }));
    return target.save();
  } finally {
    target.clear();
  }
}

async function startRecognition(prepareOnly) {
  if (state.busy || !editor.finish()) return;
  const dialog = $('ocr-dialog');
  const label = $('ocr-status');
  const buttons = [$('run-ocr'), $('prepare-ocr')];
  let pageLabel = '';
  state.busy = true;
  buttons.forEach(button => { button.disabled = true; });
  syncControls();
  label.textContent = 'Загружаем локальный OCR…';
  try {
    const worker = await prepareOCR(({ status: job, progress }) => {
      const percent = Number.isFinite(progress) ? ' ' + Math.round(progress * 100) + '%' : '';
      label.textContent = pageLabel
        ? (job === 'recognizing text' ? pageLabel + percent : pageLabel)
        : 'Готовим компоненты OCR…' + percent;
    });
    if (prepareOnly) {
      label.textContent = 'Готово. В этой вкладке можно отключить сеть и распознавать сканы.';
      return;
    }
    const selected = $('ocr-scope').value === 'all' ? Array.from({ length: state.engine.count }, (_, i) => i) : [state.index];
    const pages = [];
    let doubtful = 0, count = 0;
    for (const index of selected) {
      const small = state.engine.render(index, 20, 20, true);
      if (small.objects.some(item => item.kind === kinds.text && item.text?.trim())) continue;
      pageLabel = `Распознаём страницу ${index + 1} из ${state.engine.count}…`;
      label.textContent = pageLabel;
      const view = state.engine.render(index, 2200, 3000);
      const result = await recognizePage(worker, view);
      doubtful += result.doubtful;
      if (result.lines.length) pages.push({ index, lines: result.lines });
      count++;
    }
    if (!count) {
      label.textContent = 'У выбранных страниц уже есть текстовый слой.';
      return;
    }
    if (!pages.length) {
      label.textContent = 'Читаемых строк не найдено. Попробуйте более чёткий скан.';
      return;
    }
    state.busy = false;
    if (mutate(engine => pages.forEach(({ index, lines }) => engine.addScanLayer(index, lines)))) {
      dialog.close();
      notice(doubtful ? `Текст распознан. Сомнительных символов (*): ${doubtful}.` : 'Текст распознан. Нажмите на строку для правки.');
    } else label.textContent = 'Не удалось сохранить распознанный текст.';
  } catch (error) {
    console.error(error);
    label.textContent = 'OCR не запустился. Проверьте загрузку компонентов и попробуйте снова.';
  } finally {
    state.busy = false;
    buttons.forEach(button => { button.disabled = false; });
    syncControls();
  }
}

async function openDemo() {
  state.busy = true;
  syncControls();
  try {
    const response = await fetch(new URL('./demo.pdf', import.meta.url));
    if (!response.ok) throw new Error('Не удалось загрузить пример.');
    loadDocument(new Uint8Array(await response.arrayBuffer()), demoName, true);
  } catch (error) {
    report(error);
    if (!state.engine.count) {
      $('welcome').querySelector('p').textContent = 'Откройте свой PDF, чтобы начать работу.';
      status('Откройте PDF');
    }
  } finally {
    state.busy = false;
    syncControls();
  }
}

function setFilter(filter) {
  state.filter = filter;
  state.expanded = false;
  document.querySelectorAll('[data-filter]').forEach(button => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
  renderObjects();
}

function openPicker() {
  if (!state.busy && confirmOpen()) $('file-input').click();
}

async function handleImage(file, target) {
  if (!file || !target || target.page !== state.index || target.entry !== state.history[state.revision]) return;
  try {
    const { bytes, format, ratio } = await readArtwork(file);
    if (target.page !== state.index || target.entry !== state.history[state.revision]) return;
    setMode('select');
    mutate(engine => target.replace !== undefined
      ? engine.replaceImage(state.index, target.replace, bytes, format)
      : engine.addImage(state.index, target.x, target.y, bytes, format, ratio),
    { select: true, message: target.replace === undefined ? 'Изображение добавлено' : 'Изображение заменено' });
  } catch (error) {
    report(error);
  }
}

function selectedField() {
  return editor.layer.querySelector('.inline-text, .inline-cell.active');
}

const areaClipboardType = 'application/x-listpdf-area';

function rememberClipboard(payload, systemEvent) {
  state.clipboard = payload;
  if (systemEvent) {
    systemEvent.preventDefault();
    systemEvent.clipboardData?.setData('text/plain', payload.text ?? '');
    if (payload.type === 'area') {
      systemEvent.clipboardData?.setData(areaClipboardType, payload.id);
    }
  } else if (payload.text && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(payload.text).catch(() => {});
  }
  $('clipboard-status').textContent = 'В буфере находится ' + payload.label + '.';
  notice('Скопировано');
}

function copySelection(event) {
  if (state.busy || !state.engine?.count) return;
  const draft = editor.draft;
  const field = selectedField();
  try {
    if (draft && field?.selectionStart !== field?.selectionEnd) {
      const text = field.value.slice(field.selectionStart, field.selectionEnd);
      rememberClipboard({ type: 'text', label: 'текст', text, format: draft.mode === 'text' ? textFormat(draft) : null }, event);
    } else if (draft?.mode === 'text' && draft.text.trim()) {
      rememberClipboard({ type: 'text', label: 'текст', text: draft.text, format: textFormat(draft) }, event);
    } else if (draft?.mode === 'table') {
      const { rows, widths, heights, font, size, boldHeader, style } = editor.plan();
      const table = structuredClone({ rows, widths, heights, font, size, boldHeader, style });
      rememberClipboard({ type: 'table', label: 'таблица', table, text: rows.map(row => row.join('\t')).join('\n') }, event);
    } else if (state.area) {
      copyArea(state.area, event);
    } else {
      const object = getSelected();
      if (!object) {
        notice('Выберите область, текст, таблицу или объект.');
        return;
      }
      const bytes = state.engine.copyPage(state.index, object);
      rememberClipboard({ type: 'object', label: imageLike(object) ? 'изображение' : 'объект', bytes, image: imageLike(object) }, event);
    }
    $('clipboard-dialog').close();
  } catch (error) { report(error); }
}

function textFormat(draft) {
  const { font, size, bold, italic, underline, strike, color } = draft;
  return { font, size, originalSize: size, bold, italic, underline, strike, color };
}

function copyWholePage() {
  try {
    rememberClipboard({ type: 'page', label: 'страница', bytes: state.engine.copyPage(state.index) });
    $('clipboard-dialog').close();
  } catch (error) { report(error); }
}

function copyPageText() {
  const text = (state.page?.objects ?? []).filter(object => object.kind === kinds.text && !object.watermark && object.text?.trim())
    .sort((a, b) => Math.abs(a.y - b.y) < .004 ? a.x - b.x : a.y - b.y).map(object => object.text.trim()).join('\n');
  if (!text) {
    $('clipboard-status').textContent = 'На странице нет текста. Для скана сначала запустите распознавание.';
    return;
  }
  rememberClipboard({ type: 'text', label: 'текст страницы', text });
  $('clipboard-dialog').close();
}

function beginPaste(payload) {
  if (!payload || state.busy) return;
  const field = selectedField();
  if (field && payload.type === 'text') {
    field.focus({ preventScroll: true });
    field.setRangeText(payload.text.slice(0, Math.max(0, field.maxLength - field.value.length + field.selectionEnd - field.selectionStart)), field.selectionStart, field.selectionEnd, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (!editor.finish()) return;
  if (payload.type === 'page') {
    const source = state.engine.temporary();
    try {
      source.open(payload.bytes);
      const next = state.index + 1;
      mutate(engine => engine.importPage(source, 0, next), { page: next, message: 'Страница вставлена' });
    } catch (error) { report(error); }
    finally { source.clear(); }
    return;
  }
  state.pendingPaste = payload;
  state.pastePoint = state.lastPagePoint ?? { x: .08, y: .08 };
  state.suppressClickUntil = 0;
  selectObject(null);
  setMode('paste');
}

function bitmapPosition(point, { width: storedWidth, ratio }) {
  const { pageWidth, pageHeight } = state.page;
  const width = Math.min(storedWidth, pageWidth, pageHeight * ratio);
  const height = width / ratio;
  return { width, height, x: Math.max(0, Math.min(point.x * pageWidth, pageWidth - width)),
    y: Math.max(0, Math.min(point.y * pageHeight, pageHeight - height)) };
}

function pasteAt(point) {
  const payload = state.pendingPaste;
  state.pendingPaste = null;
  state.pastePoint = null;
  setMode('select');
  const { pageWidth, pageHeight } = state.page;
  if (payload.type === 'text') editor.newText(point.x * pageWidth, point.y * pageHeight, payload.text.slice(0, 12000), payload.format ?? {});
  else if (payload.type === 'table') {
    const table = payload.table;
    const total = table.widths.reduce((sum, width) => sum + width, 0);
    const scale = Math.min(1, (pageWidth - 14) / total);
    const widths = table.widths.map(width => width * scale);
    editor.openTable({ ...table, widths, x: Math.max(5, Math.min(point.x * pageWidth, pageWidth - total * scale - 7)),
      y: Math.max(5, point.y * pageHeight), h: 0, indices: [], shift: false });
  } else if (payload.type === 'bitmap' || payload.type === 'area') {
    const { bytes, format, ratio, width: storedWidth } = payload.image;
    const insert = storedWidth ? engine => engine.edit(state.index, page =>
      engine.placeImage(page, { ...bitmapPosition(point, payload.image), bytes, format }))
      : engine => engine.addImage(state.index, point.x, point.y, bytes, format, ratio);
    mutate(insert, { select: true, message: payload.type === 'area' ? 'Область вставлена' : 'Изображение вставлено' });
  } else mutate(engine => engine.pasteObject(state.index, payload, point), { select: true, message: 'Объект вставлен' });
}

function areaBounds(start, end) {
  const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
  return { x, y, w: Math.abs(start.x - end.x), h: Math.abs(start.y - end.y) };
}

function areaPoint(event) {
  const point = atPosition(event);
  return { x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) };
}

function clearArea() {
  closePageMenu();
  state.area = null;
  state.areaDrag = null;
}

function copyArea(area, event) {
  try {
    const page = state.engine.render(state.index, 2200, 2800);
    const x = Math.floor(area.x * page.width), y = Math.floor(area.y * page.height);
    const width = Math.min(page.width, Math.ceil((area.x + area.w) * page.width)) - x;
    const height = Math.min(page.height, Math.ceil((area.y + area.h) * page.height)) - y;
    const crop = document.createElement('canvas');
    crop.width = width;
    crop.height = height;
    crop.getContext('2d').putImageData(new ImageData(page.pixels, page.width, page.height), -x, -y, x, y, width, height);
    const preview = crop.toDataURL('image/png');
    const bytes = Uint8Array.from(atob(preview.split(',')[1]), char => char.charCodeAt(0));
    const text = event ? state.engine.textInArea(state.index, area) : '';
    rememberClipboard({ type: 'area', id: crypto.randomUUID(), localOnly: !event, label: 'фрагмент страницы', text, image: {
      bytes, preview, format: 'png', ratio: width / height, width: area.w * page.pageWidth,
    } }, event);
    status('Область скопирована. Нажмите Ctrl+V и укажите место вставки.');
  } catch (error) { report(error); }
}

function copyAreaText(area) {
  const text = state.engine.textInArea(state.index, area);
  if (text) rememberClipboard({ type: 'text', label: 'текст области', text });
  else notice('В области нет текста. Для скана сначала запустите распознавание.');
}

function closePageMenu(restoreFocus = false) {
  if (pageMenu.hidden) return;
  pageMenu.hidden = true;
  areaActions.setAttribute('aria-expanded', 'false');
  if (restoreFocus) (areaActions.hidden ? stage : areaActions).focus({ preventScroll: true });
}

function openPageMenu(point, left, top, area = null) {
  const actions = [];
  if (area) {
    actions.push(['Копировать область', () => copyArea(area)],
      ['Копировать текст области', () => copyAreaText(area)],
      ['Комментарий к области', () => addComment({ ...area, label: 'Выделенная область' })],
      ['Снять выделение', () => setMode(state.mode)]);
  } else {
    const object = objectAt(point);
    const table = tableAt(point);
    if (table) actions.push(['Редактировать таблицу', () => editTable(table, point)]);
    else if (object?.kind === kinds.text) actions.push(['Редактировать текст', () => editText(object, point)]);
    if (object) {
      actions.push(['Копировать объект', () => {
        rememberClipboard({ type: 'object', label: imageLike(object) ? 'изображение' : 'объект',
          bytes: state.engine.copyPage(state.index, object), image: imageLike(object) });
      }], ['Добавить комментарий', () => addComment(object, point)]);
    }
    actions.push(['Выделить область', () => { selectObject(null); setMode('area'); }]);
  }
  if (state.clipboard) actions.push(['Вставить сюда', () => {
    beginPaste(state.clipboard);
    if (state.mode === 'paste' && state.pendingPaste) pasteAt(point);
  }]);
  pageMenu.replaceChildren(...actions.map(([label, run]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = label;
    button.addEventListener('click', () => {
      closePageMenu(true);
      try { run(); } catch (error) { report(error); }
    });
    return button;
  }));
  pageMenu.hidden = false;
  areaActions.setAttribute('aria-expanded', String(Boolean(area)));
  pageMenu.style.left = `${Math.max(6, Math.min(left, window.innerWidth - pageMenu.offsetWidth - 6))}px`;
  pageMenu.style.top = `${Math.max(6, Math.min(top, window.innerHeight - pageMenu.offsetHeight - 6))}px`;
  pageMenu.firstElementChild.focus({ preventScroll: true });
}

paper.addEventListener('contextmenu', event => {
  if (state.busy || !state.page || event.target.closest('input, textarea, select, [contenteditable], .comment-pin')) return;
  event.preventDefault();
  if (!editor.finish()) return;
  const point = areaPoint(event);
  const area = state.area;
  const inside = area && point.x >= area.x && point.x <= area.x + area.w && point.y >= area.y && point.y <= area.y + area.h;
  openPageMenu(point, event.clientX, event.clientY, inside ? area : null);
});
areaActions.addEventListener('click', () => {
  if (!state.area || state.busy) return;
  if (!pageMenu.hidden) { closePageMenu(true); return; }
  const rectangle = areaActions.getBoundingClientRect();
  openPageMenu({ x: state.area.x, y: state.area.y }, rectangle.left, rectangle.bottom, state.area);
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest?.('#page-menu, #area-actions')) closePageMenu();
});
stage.addEventListener('scroll', () => closePageMenu());
window.addEventListener('resize', () => closePageMenu());
pageMenu.addEventListener('keydown', event => {
  const buttons = [...pageMenu.children];
  const index = buttons.indexOf(document.activeElement);
  const next = { ArrowDown: (index + 1) % buttons.length, ArrowUp: (index - 1 + buttons.length) % buttons.length,
    Home: 0, End: buttons.length - 1 }[event.key];
  if (next !== undefined) {
    event.preventDefault();
    buttons[next].focus();
  } else if (event.key === 'Escape' || event.key === 'Tab') {
    event.stopPropagation();
    closePageMenu(true);
  }
});

function externalText(text) {
  if (editor.draft) return { type: 'text', text };
  const rows = text.trimEnd().split(/\r?\n/).map(row => row.split('\t'));
  const columns = rows[0].length;
  if (columns >= 2 && columns <= 12 && rows.length <= 65 && rows.every(row => row.length === columns)) {
    return { type: 'table', table: { rows, widths: Array(columns).fill(100), heights: Array(rows.length).fill(27), font: 'Noto Sans', size: 11 } };
  }
  return { type: 'text', text };
}

async function pasteBitmap(file) {
  try {
    beginPaste({ type: 'bitmap', image: await readArtwork(file) });
  } catch (error) { report(error); }
}

function chooseImage(target) {
  state.imageTarget = { ...target, page: state.index, entry: state.history[state.revision] };
  $('image-input').value = '';
  $('image-input').click();
}

let dragFrame;
function scheduleDragPaint() {
  if (dragFrame !== undefined) return;
  dragFrame = requestAnimationFrame(() => { dragFrame = undefined; renderSafely(); });
}

function cancelDrag() {
  const moved = state.turn || imageLike(state.drag?.object);
  state.turn = null;
  state.drag = null;
  state.region = null;
  state.areaDrag = null;
  clearCommentDrag();
  state.suppressClickUntil = performance.now() + 180;
  if (moved) scheduleDragPaint();
  renderSelection();
}

bindPinch(stage, paper, {
  scale: () => Number($('fit').dataset.scale) || 1,
  zoom: value => {
    state.zoom = value;
    scheduleSession();
    paper.style.width = `${state.page.pageWidth * value}px`;
    paper.style.height = `${state.page.pageHeight * value}px`;
    $('fit').textContent = `${Math.round(value * 100)}%`;
    $('fit').dataset.scale = value;
    editor.position();
  },
  finish: () => { state.suppressClickUntil = performance.now() + 180; renderSafely(); },
  cancelDrag,
});

function dragOffset(drag, point) {
  const dx = point.x - drag.x, dy = point.y - drag.y;
  if (drag.corner) return resizeImage(drag.object, drag.corner, dx, dy, overlay.clientWidth, overlay.clientHeight);
  return imageLike(drag.object) ? containImage(drag.object, dx, dy) : { dx, dy };
}

function pointerAngle(event, center) {
  const bounds = overlay.getBoundingClientRect();
  return Math.atan2(event.clientY - bounds.top - center.y * bounds.height,
    event.clientX - bounds.left - center.x * bounds.width) * 180 / Math.PI;
}

function draggedDegrees(event, turn) {
  const delta = pointerAngle(event, turn.center) - turn.startAngle;
  const degrees = ((delta + 540) % 360) - 180;
  return event.shiftKey ? Math.round(degrees / 15) * 15 : degrees;
}

paper.addEventListener('pointerdown', event => {
  if (!event.target.closest('.rotation-grip') || state.busy || event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  event.stopPropagation();
  const wasEditing = Boolean(editor.draft);
  const object = finishForRotation();
  if (!object) return;
  if (wasEditing) renderSafely();
  const items = objectGroup(object);
  const box = objectBounds(items, object);
  const center = boxCenter(box);
  state.turn = { id: event.pointerId, object, box, center, degrees: 0,
    startAngle: pointerAngle(event, center), indices: items.map(item => item.index) };
  selectObject(object.index);
  overlay.setPointerCapture(event.pointerId);
}, true);

paper.addEventListener('keydown', event => {
  if (!event.target.closest('.rotation-grip') || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const object = finishForRotation();
  if (object && rotateObject(object, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 15 : 1))) {
    overlay.querySelector('.rotation-grip')?.focus({ preventScroll: true });
  }
});

overlay.addEventListener('keydown', event => {
  const resize = event.target.closest('.resize-grip');
  const move = event.target.closest('.selection-grip');
  if (!resize && !move) return;
  const object = getSelected();
  if (!object) return;
  if (resize) {
    if (!['+', '=', 'ArrowUp', '-', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const corner = resize.dataset.corner;
    const amount = ['-', 'ArrowDown'].includes(event.key) ? -.08 : .08;
    const { clientWidth: width, clientHeight: height } = overlay;
    const dx = (corner.includes('w') ? -1 : 1) * object.w * amount;
    const dy = (corner.includes('n') ? -1 : 1) * object.h * amount;
    const values = resizeImage(object, corner, dx, dy, width, height);
    if (Math.abs(values.widthRatio - 1) < .001) return;
    mutate(engine => engine.update(state.index, object, values), { select: true });
    overlay.querySelector(`[data-corner="${corner}"]`)?.focus({ preventScroll: true });
    return;
  }
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!direction) return;
  event.preventDefault();
  const step = event.shiftKey ? 12 : 2;
  const { pageWidth, pageHeight } = state.page;
  const offset = containImage(object, direction[0] * step / pageWidth, direction[1] * step / pageHeight);
  if (!offset.dx && !offset.dy) return;
  mutate(engine => engine.update(state.index, object, { ...offset, widthRatio: 1, heightRatio: 1 }), { select: true });
  overlay.querySelector('.selection-grip')?.focus({ preventScroll: true });
});

overlay.addEventListener('pointermove', event => {
  if (state.busy) return;
  const point = atPosition(event);
  state.lastPagePoint = point;
  if (state.turn?.id === event.pointerId) {
    state.turn.degrees = draggedDegrees(event, state.turn);
    scheduleDragPaint();
    return;
  }
  if (state.mode === 'paste' && state.pendingPaste?.type === 'area') {
    state.pastePoint = point;
    renderSelection();
    return;
  }
  if (state.commentDrag?.id === event.pointerId) {
    const drag = state.commentDrag;
    drag.end = areaPoint(event);
    if (!drag.frame && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) >= 5) {
      drag.frame = requestAnimationFrame(() => {
        drag.frame = null;
        const note = state.engine.commentRange(state.index, drag.start, drag.end);
        const boxes = note && state.engine.page(state.index, handle => state.engine.commentPosition(handle, note).boxes);
        comments.previewSelection(boxes);
      });
    }
    return;
  }
  if (state.areaDrag?.id === event.pointerId) {
    state.areaDrag.end = areaPoint(event);
    renderSelection();
    return;
  }
  if (state.region?.id === event.pointerId) {
    state.region.endX = point.x;
    state.region.endY = point.y;
    renderSelection();
    return;
  }
  if (state.mode !== 'select' || editor.draft) return;
  if (state.drag?.id === event.pointerId) {
    Object.assign(state.drag, dragOffset(state.drag, point));
    if (imageLike(state.drag.object)) scheduleDragPaint();
    else renderSelection();
    return;
  }
  if (event.target.closest('.image-selected, .rotation-grip')) return;
  const table = tableAt(point);
  const object = table
    ? { index: -1, x: table.x / state.page.pageWidth, y: table.y / state.page.pageHeight,
      w: table.w / state.page.pageWidth, h: table.h / state.page.pageHeight }
    : objectAt(point);
  overlay.style.cursor = object?.kind === kinds.text ? 'text' : object ? 'pointer' : 'default';
  if (object !== state.hover) {
    state.hover = object;
    renderSelection();
  }
});
overlay.addEventListener('pointerleave', () => {
  if (state.turn) return;
  state.hover = null;
  if (!state.drag) renderSelection();
});
overlay.addEventListener('pointerdown', event => {
  if (event.button !== 0 || state.busy || !event.isPrimary || event.target.closest('[data-image-action]')) return;
  if (event.pointerType === 'mouse') state.suppressClickUntil = 0;
  const point = atPosition(event);
  if (state.mode === 'table') {
    state.region = { ...point, endX: point.x, endY: point.y, id: event.pointerId };
    overlay.setPointerCapture(event.pointerId);
    return;
  }
  if (editor.draft) return;
  if (state.mode === 'comment') {
    state.commentDrag = { id: event.pointerId, start: areaPoint(event), clientX: event.clientX, clientY: event.clientY };
    overlay.setPointerCapture(event.pointerId);
    return;
  }
  const blankMouse = event.pointerType === 'mouse' && !event.target.closest('.image-selected')
    && !objectAt(point) && !tableAt(point);
  if (state.mode === 'area' || state.mode === 'select' && (event.shiftKey || blankMouse)) {
    const start = areaPoint(event);
    state.areaDrag = { ...start, end: start, id: event.pointerId };
    overlay.setPointerCapture(event.pointerId);
    return;
  }
  if (state.mode !== 'select') return;
  const grip = event.target.closest('.selection-grip');
  const corner = event.target.closest('.resize-grip')?.dataset.corner;
  const current = getSelected();
  const inside = current && point.x >= current.x && point.x <= current.x + current.w
    && point.y >= current.y && point.y <= current.y + current.h;
  if (current && (grip || corner || inside && (event.pointerType !== 'touch' || imageLike(current)))) {
    state.drag = { ...point, dx: 0, dy: 0, widthRatio: 1, heightRatio: 1, id: event.pointerId, object: current, corner };
    overlay.setPointerCapture(event.pointerId);
  }
});
overlay.addEventListener('pointercancel', cancelDrag);
overlay.addEventListener('lostpointercapture', event => {
  if (state.turn?.id === event.pointerId) cancelDrag();
});
overlay.addEventListener('pointerup', event => {
  if (state.turn?.id === event.pointerId) {
    const turn = state.turn;
    const degrees = draggedDegrees(event, turn);
    state.turn = null;
    state.suppressClickUntil = performance.now() + 180;
    if (Math.abs(degrees) < .3 || !rotateObject(turn.object, degrees)) renderSafely();
    return;
  }
  if (state.commentDrag?.id === event.pointerId) {
    const { start, clientX, clientY } = state.commentDrag;
    clearCommentDrag();
    if (Math.hypot(event.clientX - clientX, event.clientY - clientY) >= 5) {
      state.suppressClickUntil = performance.now() + 180;
      const note = state.engine.commentRange(state.index, start, areaPoint(event));
      if (note) beginComment(note);
      else notice('Начните и закончите выделение на тексте. Для скана сначала распознайте текст.');
    }
    return;
  }
  if (state.areaDrag?.id === event.pointerId) {
    const bounds = areaBounds(state.areaDrag, areaPoint(event));
    state.areaDrag = null;
    clearArea();
    if (bounds.w * overlay.clientWidth >= 4 && bounds.h * overlay.clientHeight >= 4) {
      state.area = bounds;
      state.suppressClickUntil = performance.now() + 180;
      status('Область выделена');
    } else if (state.mode === 'select') {
      status('Готово к редактированию');
    }
    selectObject(null);
    return;
  }
  if (state.region?.id === event.pointerId) {
    const { x, y } = state.region;
    state.region = null;
    const end = atPosition(event);
    if (Math.hypot((end.x - x) * overlay.clientWidth, (end.y - y) * overlay.clientHeight) > 14) {
      const { pageWidth: w, pageHeight: h } = state.page;
      const box = { x: Math.min(x, end.x) * w, y: Math.min(y, end.y) * h, w: Math.abs(end.x - x) * w, h: Math.abs(end.y - y) * h };
      state.suppressClickUntil = performance.now() + 175;
      const existing = state.tables.find(table => table.x >= box.x - 5 && table.x + table.w <= box.x + box.w + 5
        && table.y >= box.y - 5 && table.y + table.h <= box.y + box.h + 5);
      const table = existing ?? tableFromRegion(state.page, box);
      if (table) editTable(table);
      else notice('Обведите целую таблицу с данными хотя бы в двух строках и столбцах.', true);
    }
    renderSelection();
    return;
  }
  if (state.drag?.id !== event.pointerId) return;
  const { object, corner } = state.drag;
  const values = dragOffset(state.drag, atPosition(event));
  const { dx, dy, widthRatio = 1 } = values;
  state.drag = null;
  const change = corner ? Math.abs(widthRatio - 1) * Math.max(object.w * overlay.clientWidth, object.h * overlay.clientHeight)
    : Math.hypot(dx * overlay.clientWidth, dy * overlay.clientHeight);
  if (change < 4) {
    if (imageLike(object)) {
      state.suppressClickUntil = performance.now() + 130;
      scheduleDragPaint();
    }
    renderSelection();
    return;
  }
  state.suppressClickUntil = performance.now() + 100;
  mutate(engine => engine.update(state.index, object, values), {
    select: true, message: corner ? 'Размер изображения изменён' : 'Объект перемещён',
  });
});
overlay.addEventListener('click', event => {
  if (state.busy || performance.now() < state.suppressClickUntil) return;
  const action = event.target.closest('[data-image-action]')?.dataset.imageAction;
  if (action) {
    if (action === 'delete') removeSelected();
    else if (getSelected()) rotateObject(getSelected(), 90);
    return;
  }
  if (editor.draft) {
    editor.finish();
    return;
  }
  const point = atPosition(event);
  const { x, y } = point;
  const mode = state.mode;
  if (state.area) {
    clearArea();
    renderSelection();
    status('Готово к редактированию');
  }
  const { pageWidth: width, pageHeight: height } = state.page;
  if (mode === 'paste') {
    pasteAt(point);
    return;
  }
  if (mode === 'marker') {
    const object = objectAt(point);
    const anchor = object?.kind === kinds.text && state.engine.wordAt(state.index, point.x, point.y, object.index);
    if (!anchor) {
      notice('Нажмите на слово на странице или в таблице.');
      return;
    }
    const color = state.markerColor;
    if (!color && state.engine.page(state.index, page => state.engine.markerIndex(page, anchor.raw)) < 0) {
      notice('У этого слова нет выделения маркером.');
      return;
    }
    mutate(engine => engine.markWord(state.index, anchor, color), { message: color ? 'Слово выделено' : 'Выделение снято' });
    return;
  }
  if (mode === 'comment') {
    const object = objectAt(point, true);
    const table = tableAt(point);
    if (object) addComment(object, point);
    else if (table) addComment({ x: table.x / width, y: table.y / height, w: table.w / width, h: table.h / height }, point);
    else notice('Выберите слово или объект на странице.');
    return;
  }
  const table = mode === 'select' || mode === 'table' ? tableAt(point) : null;
  if (table) {
    editTable(table, point);
    return;
  }
  const object = mode === 'select' || mode === 'text' ? objectAt(point) : null;
  if (object?.kind === kinds.text && !object.watermark && !object.tableId && object.horizontal) {
    editText(object, point);
    return;
  }
  if (mode === 'select') selectObject(object?.index ?? null, { showPanel: true });
  if (mode === 'image') chooseImage({ x, y });
  if (mode === 'qr') {
    setMode('select');
    mutate(engine => engine.addImage(state.index, x, y, state.qr, 'png', 1, 150),
      { select: true, message: 'QR-код добавлен' });
  }
  if (mode === 'stamp') {
    const stamp = state.stamp;
    setMode('select');
    if (!stamp) return;
    if (stamp.text) editor.newText(x * width, y * height, stamp.text);
    else mutate(engine => engine.addImage(state.index, x, y, stamp.bytes, stamp.format, stamp.ratio, stamp.limit),
      { select: true, message: stamp.label + ' добавлена' });
  }
  if (mode === 'shape') {
    const { figure, color } = state.shape;
    setMode('select');
    mutate(engine => engine.addShape(state.index, x, y, figure, color), { select: true, message: 'Фигура добавлена' });
  }
  if (mode === 'text' || mode === 'table') {
    setMode('select');
    if (mode === 'text') editor.newText(x * width, y * height);
    else editor.newTable(x * width, y * height);
  }
});

$('ocr').addEventListener('click', () => { if (editor.finish()) $('ocr-dialog').showModal(); });
$('run-ocr').addEventListener('click', () => startRecognition(false));
$('prepare-ocr').addEventListener('click', () => startRecognition(true));
$('clipboard').addEventListener('click', () => {
  $('paste-selection').disabled = !state.clipboard;
  $('clipboard-status').textContent = state.clipboard ? 'В буфере находится ' + state.clipboard.label + '.' : 'Буфер редактора пуст.';
  $('clipboard-dialog').showModal();
});
$('copy-selection').addEventListener('click', () => copySelection());
$('copy-page').addEventListener('click', copyWholePage);
$('copy-page-text').addEventListener('click', copyPageText);
$('paste-selection').addEventListener('click', () => {
  $('clipboard-dialog').close();
  beginPaste(state.clipboard);
});
$('paste-system').addEventListener('click', async () => {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read().catch(() => []);
      for (const item of items) {
        const image = item.types.find(type => ['image/png', 'image/jpeg'].includes(type));
        if (image) {
          $('clipboard-dialog').close();
          await pasteBitmap(await item.getType(image));
          return;
        }
      }
    }
    const text = await navigator.clipboard.readText();
    if (!text) {
      $('clipboard-status').textContent = 'В системном буфере нет текста или изображения.';
      return;
    }
    $('clipboard-dialog').close();
    beginPaste(externalText(text));
  } catch {
    $('clipboard-status').textContent = 'Браузер ограничил доступ. Вставьте через обычную команду «Вставить».';
  }
});
const clipboardField = target => target.closest?.('input, textarea, select, dialog, [contenteditable]');
let areaPasteFallback;
document.addEventListener('copy', event => {
  if (!clipboardField(event.target)) copySelection(event);
});
document.addEventListener('paste', event => {
  clearTimeout(areaPasteFallback);
  if (clipboardField(event.target) || state.busy || !state.engine?.count) return;
  const image = Array.from(event.clipboardData?.files ?? []).find(file => /^image\/(png|jpeg)$/i.test(file.type));
  if (image) {
    event.preventDefault();
    pasteBitmap(image);
    return;
  }
  const text = event.clipboardData?.getData('text/plain');
  const clip = state.clipboard;
  const localArea = clip?.type === 'area' && (clip.localOnly || event.clipboardData?.getData(areaClipboardType) === clip.id);
  const copy = !localArea && text && text !== clip?.text ? externalText(text) : clip;
  if (!copy) return;
  event.preventDefault();
  beginPaste(copy);
});

$('marker').addEventListener('click', () => {
  if (!editor.finish()) return;
  $('leave-marker').hidden = state.mode !== 'marker';
  $('marker-dialog').showModal();
});

function useMarker(color) {
  state.markerColor = color;
  $('marker-dialog').close();
  selectObject(null);
  setMode('marker');
}
document.querySelectorAll('[data-marker-color]').forEach(button => button.addEventListener('click', () => useMarker(button.dataset.markerColor)));
$('use-marker').addEventListener('click', () => useMarker($('marker-custom').value));
$('erase-marker').addEventListener('click', () => useMarker(null));
$('leave-marker').addEventListener('click', () => {
  $('marker-dialog').close();
  setMode('select');
});

for (const id of ['sign', 'convert']) {
  $(id).addEventListener('click', () => {
    if (editor.finish()) $(id + '-dialog').showModal();
  });
}
document.querySelectorAll('dialog [data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

$('shape-picker').innerHTML = shapes.map(shape => `<button class="button outlined" type="button" data-shape="${shape.id}">${shapeIcon(shape)}<span>${shape.name}</span></button>`).join('');
$('shape-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-shape]');
  if (!button) return;
  const color = $('shape-color').value.slice(1).match(/../g).map(channel => parseInt(channel, 16));
  state.shape = { figure: shapes.find(shape => shape.id === button.dataset.shape), color: [...color, 255] };
  $('shape-dialog').close();
  setMode('shape');
});

$('qr').addEventListener('click', () => {
  if (!editor.finish()) return;
  if (state.mode === 'qr') setMode('select');
  $('place-qr').disabled = !state.engine?.count || state.busy;
  $('qr-dialog').showModal();
});
function clearQrPreview() {
  state.qr = null;
  $('qr-preview').hidden = $('qr-actions').hidden = $('qr-status').hidden = true;
}
$('qr-text').addEventListener('input', clearQrPreview);
$('qr-images').addEventListener('change', event => {
  $('clear-qr-images').hidden = !event.target.files.length;
  clearQrPreview();
});
$('clear-qr-images').addEventListener('click', () => {
  $('qr-images').value = '';
  $('clear-qr-images').hidden = true;
  $('qr-images').focus();
  clearQrPreview();
});
$('qr-form').addEventListener('submit', async event => {
  event.preventDefault();
  const field = $('qr-text');
  const images = $('qr-images');
  const clearImages = $('clear-qr-images');
  const button = $('generate-qr');
  const preview = $('qr-preview');
  const feedback = $('qr-status');
  button.disabled = images.disabled = clearImages.disabled = field.readOnly = true;
  clearQrPreview();
  try {
    state.qr = await makeQr(preview, field.value, Array.from(images.files));
    preview.hidden = $('qr-actions').hidden = false;
  } catch (error) {
    feedback.textContent = error.message || 'Не удалось создать QR-код.';
    feedback.hidden = false;
  } finally {
    button.disabled = images.disabled = clearImages.disabled = field.readOnly = false;
  }
});
$('download-qr').addEventListener('click', () => {
  if (state.qr) download(state.qr, 'QR-код.png', 'png');
});
$('place-qr').addEventListener('click', () => {
  if (!state.qr || !state.engine?.count || state.busy) return;
  $('qr-dialog').close();
  setMode('qr');
});

let watermarkDialogVersion = 0;
$('watermark').addEventListener('click', () => {
  if (!editor.finish()) return;
  watermarkDialogVersion++;
  $('watermark-status').hidden = true;
  $('watermark-dialog').showModal();
});
$('watermark-type').addEventListener('change', event => {
  const image = event.target.value === 'image';
  for (const id of ['text', 'color', 'size']) $('watermark-' + id + '-field').hidden = image;
  for (const id of ['file', 'width']) $('watermark-' + id + '-field').hidden = !image;
  $('watermark-status').hidden = true;
});
$('watermark-file').addEventListener('change', () => { $('watermark-status').hidden = true; });

$('apply-watermark').addEventListener('click', async () => {
  const dialog = $('watermark-dialog');
  const feedback = $('watermark-status');
  const isImage = $('watermark-type').value === 'image';
  const controls = ['opacity', 'angle', isImage ? 'width' : 'size'].map(name => $('watermark-' + name));
  if (controls.some(control => !control.reportValidity())) return;
  const [opacity, angle, size] = controls.map(control => control.valueAsNumber);
  const indices = $('watermark-scope').value === 'all' ? Array.from({ length: state.engine.count }, (_, i) => i) : [state.index];
  const add = change => {
    if (mutate(engine => indices.forEach(index => change(engine, index)), { message: 'Водяной знак добавлен' })) dialog.close();
  };
  if (!isImage) {
    const text = $('watermark-text').value.trim();
    if (!text) {
      $('watermark-text').focus();
      return;
    }
    const color = $('watermark-color').value.slice(1).match(/../g).map(channel => parseInt(channel, 16));
    const spec = { text, size, angle, color: [...color, Math.round(255 * opacity / 100)] };
    add((engine, index) => engine.watermark(index, spec));
    return;
  }
  const input = $('watermark-file');
  const button = $('apply-watermark');
  const file = input.files[0];
  const version = watermarkDialogVersion;
  feedback.hidden = true;
  if (!file) {
    feedback.textContent = 'Выберите PNG или JPEG.';
    feedback.hidden = false;
    input.focus();
    return;
  }
  button.disabled = true;
  try {
    const image = await readArtwork(file, { opacity: opacity / 100, maxSide: 1200 });
    if (dialog.open && watermarkDialogVersion === version) {
      add((engine, index) => engine.imageWatermark(index, { ...image, width: size, angle }));
    }
  } catch (error) {
    if (dialog.open && watermarkDialogVersion === version) {
      feedback.textContent = error.message;
      feedback.hidden = false;
    }
  } finally {
    button.disabled = false;
  }
});

for (const [type, label, limit] of [['signature', 'Подпись', 130], ['seal', 'Печать', 112]]) {
  $('pick-' + type).addEventListener('click', () => {
    state.markupTarget = type;
    $('markup-file').value = '';
    $('markup-file').click();
  });
  $('place-' + type).addEventListener('click', async () => {
    const file = stampFiles.get(type);
    if (!file) return;
    const button = $('place-' + type);
    button.disabled = true;
    try {
      const image = await readArtwork(file, { removeWhite: $('stamp-remove-white').checked });
      state.stamp = { ...image, limit, label };
      $('sign-dialog').close();
      setMode('stamp');
    } catch (error) {
      $('sign-status').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
$('markup-file').addEventListener('change', event => {
  const file = event.target.files[0];
  const type = state.markupTarget;
  if (!file || !type) return;
  stampFiles.set(type, file);
  $(type + '-name').textContent = file.name;
  $('place-' + type).disabled = false;
  $('sign-status').textContent = '';
});
$('place-initials').addEventListener('click', () => {
  const text = $('initials').value.trim();
  if (!text) {
    $('initials').focus();
    return;
  }
  state.stamp = { text };
  $('sign-dialog').close();
  setMode('stamp');
});
$('pick-office').addEventListener('click', () => {
  if (!$('convert-append').checked && !confirmOpen()) return;
  $('office-file').value = '';
  $('office-file').click();
});
$('office-file').addEventListener('change', event => openFiles(Array.from(event.target.files), $('convert-append').checked, true));
$('export-docx').addEventListener('click', () => exportOffice('docx'));
$('export-xlsx').addEventListener('click', () => exportOffice('xlsx'));

$('open').addEventListener('click', openPicker);
$('upload-document').addEventListener('click', openPicker);
$('demo').addEventListener('click', () => { if (confirmOpen()) openDemo(); });
$('export').addEventListener('click', exportFile);
$('add-files').addEventListener('click', () => {
  if (!state.busy && editor.finish()) $('append-files').click();
});
for (const id of ['file-input', 'append-files']) {
  $(id).addEventListener('change', event => {
    const files = Array.from(event.target.files);
    event.target.value = '';
    openFiles(files, id === 'append-files');
  });
}
$('image-input').addEventListener('change', event => {
  const target = state.imageTarget;
  state.imageTarget = null;
  handleImage(event.target.files[0], target);
});
document.querySelectorAll('button[data-mode]').forEach(button => {
  button.addEventListener('click', () => {
    if (!editor.finish()) return;
    const mode = button.dataset.mode;
    if (mode === 'shape') {
      $('shape-dialog').showModal();
      return;
    }
    const selected = getSelected();
    if (mode === 'comment' && state.area) addComment({ ...state.area, label: 'Выделенная область' });
    else if (mode === 'comment' && selected) addComment(selected);
    else setMode(['comment', 'area'].includes(mode) && state.mode === mode ? 'select' : mode);
  });
});
document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click', () => setFilter(button.dataset.filter));
});
$('pages-toggle').addEventListener('click', () => setPanel(state.panel === 'pages' ? null : 'pages'));
$('properties-toggle').addEventListener('click', () => setPanel(state.panel === 'properties' ? null : 'properties'));
$('properties-close').addEventListener('click', () => setPanel(null));
$('backdrop').addEventListener('click', () => setPanel(null));
mobile.addEventListener('change', () => setPanel(null));
$('prev-page').addEventListener('click', () => setPage(state.index - 1));
$('next-page').addEventListener('click', () => setPage(state.index + 1));
$('zoom-out').addEventListener('click', () => updateZoom(-1));
$('zoom-in').addEventListener('click', () => updateZoom(1));
$('fit').addEventListener('click', () => updateZoom(0));
$('fit-icon').addEventListener('click', () => updateZoom(0));
$('undo').addEventListener('click', () => restoreHistory(-1));
$('redo').addEventListener('click', () => restoreHistory(1));
$('add-page').addEventListener('click', () => mutate(engine => engine.addPage(state.index + 1), { page: state.index + 1, message: 'Страница добавлена' }));
$('rotate-page').addEventListener('click', () => mutate(engine => engine.rotate(state.index), { message: 'Страница повёрнута' }));
$('duplicate-page').addEventListener('click', () => mutate(engine => engine.duplicate(state.index), { page: state.index + 1, message: 'Страница дублирована' }));
$('move-up').addEventListener('click', () => mutate(engine => engine.movePage(state.index, state.index - 1), { page: state.index - 1, message: 'Порядок страниц изменён' }));
$('move-down').addEventListener('click', () => mutate(engine => engine.movePage(state.index, state.index + 1), { page: state.index + 1, message: 'Порядок страниц изменён' }));
$('delete-page').addEventListener('click', () => mutate(engine => engine.deletePage(state.index), { message: 'Страница удалена' }));

let pageDrag;
function showPageDrop(y) {
  const thumbnails = Array.from(thumbs.children);
  const target = thumbnails.find(thumb => thumb.getBoundingClientRect().bottom >= y) ?? thumbnails.at(-1);
  if (!target) return;
  const box = target.getBoundingClientRect();
  const after = y > (box.top + box.bottom) / 2;
  const slot = Number(target.dataset.page) + Number(after);
  pageDrag.to = slot > pageDrag.from ? slot - 1 : slot;
  if (pageDrag.target === target && pageDrag.after === after) return;
  pageDrag.target?.classList.remove('drop-before', 'drop-after');
  target.classList.add(after ? 'drop-after' : 'drop-before');
  pageDrag.target = target;
  pageDrag.after = after;
}

function finishPageDrag() {
  if (!pageDrag) return;
  clearInterval(pageDrag.scrollTimer);
  pageDrag.source.classList.remove('dragged');
  pageDrag.target?.classList.remove('drop-before', 'drop-after');
  pageDrag = null;
}

thumbs.addEventListener('dragstart', event => {
  const thumb = event.target.closest('.thumb');
  if (!thumb || state.busy || state.engine.count < 2 || !editor.finish()) {
    event.preventDefault();
    return;
  }
  const from = Number(thumb.dataset.page);
  pageDrag = { source: thumb, from, to: from, entry: state.history[state.revision], scrollDelta: 0 };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-listpdf-page', String(from));
  thumb.classList.add('dragged');
});
thumbs.addEventListener('dragover', event => {
  if (!pageDrag) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  pageDrag.y = event.clientY;
  showPageDrop(pageDrag.y);
  const { top, bottom } = thumbs.getBoundingClientRect();
  pageDrag.scrollDelta = event.clientY < top + 36 ? -12 : event.clientY > bottom - 36 ? 12 : 0;
  if (!pageDrag.scrollTimer) {
    pageDrag.scrollTimer = setInterval(() => {
      if (!pageDrag.scrollDelta) return;
      thumbs.scrollTop += pageDrag.scrollDelta;
      showPageDrop(pageDrag.y);
    }, 30);
  }
});
thumbs.addEventListener('dragleave', event => {
  if (!pageDrag || thumbs.contains(event.relatedTarget)) return;
  pageDrag.scrollDelta = 0;
  pageDrag.target?.classList.remove('drop-before', 'drop-after');
  pageDrag.target = null;
});
thumbs.addEventListener('drop', event => {
  if (!pageDrag) return;
  event.preventDefault();
  showPageDrop(event.clientY);
  const { from, to, entry } = pageDrag;
  finishPageDrag();
  if (from !== to && entry === state.history[state.revision]) {
    mutate(engine => engine.movePage(from, to), { page: to, message: 'Порядок страниц изменён' });
  }
});
thumbs.addEventListener('dragend', finishPageDrag);
thumbs.addEventListener('click', event => {
  const page = event.target.closest('[data-page]');
  if (!page) return;
  setPage(Number(page.dataset.page));
  if (mobile.matches) setPanel(null);
});
objectsPanel.addEventListener('click', event => {
  const button = event.target.closest('[data-object], [data-table]');
  if (button && editor.finish()) {
    if (button.dataset.table !== undefined) {
      const table = state.tables[Number(button.dataset.table)];
      if (table && state.mode === 'comment') {
        const { pageWidth, pageHeight } = state.page;
        addComment({ x: table.x / pageWidth, y: table.y / pageHeight, w: table.w / pageWidth, h: table.h / pageHeight });
      } else if (table) editTable(table);
      return;
    }
    const object = state.page.objects.find(object => object.index === Number(button.dataset.object));
    if (object && state.mode === 'comment') addComment(object);
    else {
      setMode('select');
      selectObject(object?.index ?? null);
    }
  }
  if (event.target.closest('[data-more]')) {
    state.expanded = !state.expanded;
    renderObjects();
  }
});
inspector.addEventListener('submit', applyProperties);
inspector.addEventListener('click', event => {
  if (event.target.closest('[data-remove]')) removeSelected();
  if (event.target.closest('[data-replace]')) chooseImage({ replace: state.selected });
  if (event.target.closest('[data-inline]')) editText(getSelected());
  if (event.target.closest('[data-inline-table]')) {
    const table = state.tables.find(entry => entry.indices.includes(state.selected));
    if (table) editTable(table);
  }
  const turn = event.target.closest('[data-turn]');
  const object = getSelected();
  if (!turn || !object) return;
  const field = turn.form.elements.namedItem('turn');
  if (turn.dataset.turn !== 'custom' || field.reportValidity()) {
    rotateObject(object, turn.dataset.turn === 'custom' ? field.valueAsNumber : Number(turn.dataset.turn));
  }
});

let dropDepth = 0;
function hasFiles(event) {
  return event.dataTransfer?.types.includes('Files');
}
document.addEventListener('dragenter', event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dropDepth++;
  $('drop-target').hidden = false;
});
document.addEventListener('dragover', event => {
  if (hasFiles(event)) event.preventDefault();
});
document.addEventListener('dragleave', event => {
  if (!hasFiles(event)) return;
  dropDepth = Math.max(0, dropDepth - 1);
  if (!dropDepth) $('drop-target').hidden = true;
});
document.addEventListener('drop', event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dropDepth = 0;
  $('drop-target').hidden = true;
  if (confirmOpen()) openFiles(Array.from(event.dataTransfer.files));
});
document.addEventListener('keydown', event => {
  if (event.target instanceof HTMLElement && event.target.closest('dialog[open]')) return;
  const key = event.key.toLowerCase();
  const editing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select');
  const shortcut = event.ctrlKey || event.metaKey;
  if (state.turn) {
    if (key === 'escape') cancelDrag();
    if (shortcut || key === 'escape') event.preventDefault();
    return;
  }
  if (shortcut && key === 'v' && !clipboardField(event.target) && state.clipboard?.type === 'area' && !state.busy && state.engine?.count) {
    clearTimeout(areaPasteFallback);
    const clip = state.clipboard;
    areaPasteFallback = setTimeout(() => {
      if (state.clipboard === clip) beginPaste(clip);
    }, 75);
  }
  if (shortcut && key === 'o') {
    event.preventDefault();
    openPicker();
  } else if (shortcut && key === 's') {
    event.preventDefault();
    exportFile();
  } else if (!editing && shortcut && ['z', 'y'].includes(key)) {
    event.preventDefault();
    restoreHistory(key === 'y' || event.shiftKey ? 1 : -1);
  } else if (key === 'escape') {
    if (editor.draft) editor.cancel();
    else if (state.area || state.areaDrag) setMode('select');
    else if (state.panel) setPanel(null);
    else {
      setMode('select');
      selectObject(null);
    }
  } else if (!editing && key === 'delete') {
    removeSelected();
  }
});
let onResize;
new ResizeObserver(() => {
  cancelAnimationFrame(onResize);
  onResize = requestAnimationFrame(() => { if (state.engine?.count) renderSafely(); });
}).observe(stage);

syncControls();
try {
  await restoreOfficeFonts();
  state.engine = await PdfEngine.create();
  await Promise.all(coreFonts.map(family => prepareBrowserFont(state.engine, family)));
  try {
    const saved = await sessionStore.read();
    if (validSession(saved)) {
      loadDocument(saved.bytes, saved.name, false);
      state.saved = saved.saved ? state.history[0].bytes : null;
      state.index = Number.isInteger(saved.page) ? Math.max(0, Math.min(saved.page, state.engine.count - 1)) : 0;
      state.zoom = Number.isFinite(saved.zoom) && saved.zoom >= .12 && saved.zoom <= 6 ? saved.zoom : null;
      refresh(true);
      if (saved.draft && ['text', 'table'].includes(saved.draft.mode)) {
        try { editor.restoreDraft(saved.draft); } catch { editor.cancel(); notice('Документ восстановлен. Незавершённую правку восстановить не удалось.', true); }
      }
      sessionStatus('Предыдущая сессия восстановлена');
      status('Готово к редактированию');
    } else {
      $('welcome-message').textContent = 'Или перетащите файл в это окно';
      status('Загрузите документ');
    }
  } catch {
    $('welcome-message').textContent = 'Или перетащите файл в это окно';
    sessionStatus('Автосохранение недоступно в этом браузере', true);
    status('Загрузите документ');
  }
  sessionReady = true;
  syncControls();
} catch (error) {
  $('welcome').querySelector('p').textContent = 'Не удалось запустить редактор. Обновите страницу.';
  status('Редактор недоступен');
  report(error);
}

// Flush pending inline text/table edits when leaving; committed changes are saved immediately.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void saveSession(); });
window.addEventListener('pagehide', () => { void saveSession(); });

function showFonts() {
  $('fonts-list').replaceChildren(...Object.keys(officeAliases).map(family => {
    const item = document.createElement('li'); item.textContent = fontLabel(family); return item;
  }));
  $('fonts-local').hidden = typeof window.queryLocalFonts !== 'function';
  $('fonts-help').textContent = typeof window.queryLocalFonts === 'function'
    ? 'Для подключения браузер запросит доступ к установленным шрифтам.'
    : 'В этом браузере выберите файлы TTF вручную. Например, из папки шрифтов Windows.';
}
async function connectFonts(read) {
  if (!state.engine || state.busy || !editor.finish()) return;
  state.busy = true; syncControls();
  $('fonts-local').disabled = $('fonts-files').disabled = true;
  $('fonts-status').textContent = 'Подключаем шрифты…';
  try {
    const buffers = await read();
    if (!buffers.length) throw new Error('Указанные офисные шрифты не найдены. Можно выбрать файлы TTF вручную.');
    const result = await installOfficeFonts(buffers);
    for (const { family } of result.records) state.engine.invalidateFont(family);
    showFonts();
    $('fonts-status').textContent = `Подключено начертаний: ${result.records.length}. ` + (result.persisted ? 'Сохранены в этом браузере.' : 'Работают до закрытия страницы; сохранить их в браузере не удалось.');
  } catch (error) { $('fonts-status').textContent = error.message || 'Шрифты не подключены.'; }
  finally { state.busy = false; syncControls(); $('fonts-local').disabled = $('fonts-files').disabled = false; }
}
$('fonts-open').addEventListener('click', () => { showFonts(); $('fonts-dialog').showModal(); });
$('fonts-close').addEventListener('click', () => $('fonts-dialog').close());
$('fonts-files').addEventListener('click', () => $('font-input').click());
$('font-input').addEventListener('change', event => {
  const files = [...event.target.files]; event.target.value = '';
  if (files.length) void connectFonts(() => Promise.all(files.map(file => file.arrayBuffer())));
});
$('fonts-local').addEventListener('click', () => connectFonts(async () => {
  const available = await window.queryLocalFonts();
  const wanted = new Set(Object.keys(officeAliases).map(name => name.toLowerCase()));
  const matches = available.filter(font => wanted.has(font.family.toLowerCase()) && !/light|black|medium|semibold/i.test(font.style));
  return Promise.all(matches.map(async font => (await font.blob()).arrayBuffer()));
}));
