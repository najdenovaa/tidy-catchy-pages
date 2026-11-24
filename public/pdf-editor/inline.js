import { resizeTextBox, moveTextBox, pointsPerMillimeter } from './text-box.js';
import { officeAliases, fontLabel } from './office-fonts.js';
import { fonts, matchingFont, textBlock, wrapText } from './layout.js';
import { icon } from './icons.js';
import { borderCSS, borderPatterns, edgeStyle, tableStyle } from './table-style.js';

const sum = values => values.reduce((total, value) => total + value, 0);
const colorHex = color => '#' + color.slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('');
const colorArray = color => [...color.slice(1).match(/../g).map(channel => parseInt(channel, 16)), 255];
const officeFonts = [...Object.keys(officeAliases), 'Carlito', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'PT Sans', 'PT Serif'];
const fontOptions = () => [['Офисные', officeFonts], ['Остальные', fonts.filter(family => !officeFonts.includes(family)).sort()]]
  .map(([group, families]) => `<optgroup label="${group}">${families.map(family => `<option value="${family}">${fontLabel(family)}</option>`).join('')}</optgroup>`).join('');
const styleButtons = [
  ['bold', 'Ж', 'Полужирный'], ['italic', 'К', 'Курсив'],
  ['underline', 'П', 'Подчёркнутый'], ['strike', 'З', 'Зачёркнутый'],
];
const maxRows = 65;
const maxColumns = 12;

export class InlineEditor {
  constructor({ layer, toolbar, stylebar, getPage, render, commit, message, loadFont, changed = () => {}, scanRect = () => null }) {
    Object.assign(this, { layer, toolbar, stylebar, getPage, render, commit, message, loadFont, changed, scanRect });
    this.fillColor = '#fff2a8';
    this.stylebar.addEventListener('input', event => this.styleInput(event));
    this.stylebar.addEventListener('click', event => this.action(event));
    this.draft = null;
    this.measurer = document.createElement('canvas').getContext('2d');
    this.toolbar.addEventListener('input', event => this.format(event));
    this.toolbar.addEventListener('focusout', event => { if (event.target.name === 'text-width') this.position(); });
    this.toolbar.addEventListener('click', event => this.action(event));
    this.layer.addEventListener('keydown', event => this.key(event));
    this.layer.addEventListener('focusin', event => this.focusCell(event));
    this.layer.addEventListener('input', event => this.input(event));
    this.layer.addEventListener('pointerdown', event => this.grab(event));
    this.layer.addEventListener('pointermove', event => this.drag(event));
    this.layer.addEventListener('pointerup', () => { this.dragStart = null; });
    this.layer.addEventListener('pointercancel', () => { this.dragStart = null; });
  }

  restoreDraft(snapshot) {
    const draft = structuredClone(snapshot);
    this.open(draft);
    if (draft.mode === 'text') {
      const input = document.createElement('textarea');
      input.className = 'inline-text';
      input.setAttribute('aria-label', 'Текст на странице');
      input.maxLength = 12000;
      input.spellcheck = false;
      input.value = draft.text;
      this.layer.replaceChildren(input);
      this.textControls();
    } else this.renderTable();
    this.updateDraft();
  }

  selectText(object, excluded, point) {
    const page = this.getPage();
    const block = textBlock(object, page, excluded);
    this.openText({
      ...block, size: block.scanCover?.size ?? (object.visualSize || object.size || 14), shift: !block.scanCover, bold: object.bold, italic: object.italic,
      color: colorHex(object.color), alpha: object.color[3], font: block.font ?? matchingFont(object.fontName),
    }, point);
  }

  newText(x, y, text = '', formatting = {}) {
    const page = this.getPage();
    const left = Math.min(Math.max(x, 8), page.pageWidth - 80);
    const top = Math.max(y, 6);
    this.openText({
      x: left, y: top, width: Math.max(58, page.pageWidth - left - 26), baseline: top + 13,
      after: top, lineHeight: 18, indices: [], rows: 0, text, dirty: Boolean(text), shift: !text, size: 14, bold: false,
      color: '#202538', font: fonts[0], ...formatting,
    });
  }

  openText(data, point) {
    this.open({ ...data, mode: 'text', id: data.id ?? crypto.randomUUID(), originalSize: data.size, dirty: data.dirty ?? false, shift: data.shift ?? true });
    const input = document.createElement('textarea');
    input.className = 'inline-text';
    input.setAttribute('aria-label', 'Текст на странице');
    input.maxLength = 12000;
    input.spellcheck = false;
    input.value = data.text;
    this.layer.replaceChildren(input);
    this.textControls();
    this.updateDraft();
    input.focus({ preventScroll: true });
    const caret = point ? this.caretAt(point) : data.text.length;
    input.setSelectionRange(caret, caret);
  }

  textControls() {
    const grip = document.createElement('button');
    grip.type = 'button'; grip.className = 'text-grip';
    grip.title = 'Переместить текстовое поле'; grip.setAttribute('aria-label', grip.title);
    grip.innerHTML = icon('move');
    const resize = document.createElement('button');
    resize.type = 'button'; resize.className = 'text-resize';
    resize.title = 'Изменить ширину текстового поля'; resize.setAttribute('aria-label', resize.title);
    if (this.draft.scanCover) {
      const mask = document.createElement('div'); mask.className = 'scan-edit-mask';
      mask.setAttribute('aria-hidden', 'true'); this.layer.append(mask);
    }
    this.layer.append(grip, resize);
  }

  resizeTo(width) {
    if (this.draft?.mode !== 'text') return;
    resizeTextBox(this.draft, width, this.getPage());
    this.updateDraft();
  }

  caretAt({ x, y }) {
    const plan = this.plan();
    if (!plan.lines.length) return 0;
    const row = Math.min(plan.lines.length - 1, Math.max(0, Math.round((y - plan.baseline + plan.size * .35) / plan.lineHeight)));
    let offset = 0;
    for (const text of plan.lines.slice(0, row)) {
      if (!text) {
        offset = plan.text.indexOf('\n', offset) + 1 || offset;
        continue;
      }
      const next = plan.text.indexOf(text, offset);
      if (next >= 0) offset = next + text.length;
    }
    const text = plan.lines[row];
    const index = Math.max(offset, plan.text.indexOf(text, offset));
    let caret = 0;
    while (caret < text.length && this.measure(text.slice(0, caret + 1), plan.bold) < x - plan.x) caret++;
    return index + caret;
  }

  newTable(x, y) {
    const page = this.getPage();
    const width = Math.min(370, page.pageWidth - 34);
    const left = Math.max(7, Math.min(x, page.pageWidth - width - 12));
    const top = Math.max(y, 8);
    this.openTable({
      x: left, y: top, w: width, h: 0, widths: Array(3).fill(width / 3),
      heights: Array(3).fill(30), rows: Array.from({ length: 3 }, () => Array(3).fill('')),
      indices: [], size: 11, font: fonts[0], boldHeader: false,
    });
  }

  openTable(table, point) {
    const { x, y, h } = table;
    const hit = (values, position) => {
      let index = 0;
      while (index < values.length - 1 && position > values[index]) position -= values[index++];
      return index;
    };
    this.open({
      ...table, mode: 'table', id: table.id ?? crypto.randomUUID(),
      rows: table.rows.map(row => [...row]), widths: [...table.widths], heights: [...table.heights],
      style: tableStyle(table.style, table.rows.length, table.widths.length), borderScope: 'table',
      after: y + h, row: point ? hit(table.heights, point.y - y) : 0,
      col: point ? hit(table.widths, point.x - x) : 0, color: '#202538',
      dirty: !table.indices.length, shift: table.shift ?? true,
    });
    this.renderTable();
    this.activeCell(Boolean(point));
    this.updateDraft();
  }

  open(draft) {
    draft.font = fonts.includes(draft.font) ? draft.font : matchingFont(draft.font);
    if (draft.mode === 'text') draft.originalBaseline ??= draft.baseline;
    this.draft = draft;
    this.lastDelta = undefined;
    this.layer.hidden = false;
    this.toolbar.hidden = false;
    this.stylebar.hidden = true;
    this.stylebar.replaceChildren();
    this.toolbar.innerHTML = draft.mode === 'text'
      ? `<label>Шрифт <select name="font" aria-label="Шрифт">${fontOptions()}</select></label>
        <label>Размер <input name="size" aria-label="Размер шрифта" type="number" min="1" max="120" step="1"></label>
        <div class="font-styles">${styleButtons.map(([name, glyph, label]) =>
          `<button type="button" class="icon-button font-${name}" data-action="${name}" title="${label}" aria-label="${label}" aria-pressed="${!!draft[name]}">${glyph}</button>`
        ).join('')}</div>
        <label class="inline-color"><input name="color" aria-label="Цвет текста" type="color"></label>`
      : `<div class="inline-table-actions">
          <button type="button" class="button outlined" data-action="table-style" aria-pressed="false">Границы и заливка</button>
          <label>Шрифт <select name="font" aria-label="Шрифт таблицы">${fontOptions()}</select></label>
          <button type="button" class="button outlined" data-action="row" title="Добавить строку под выбранной">Строка +</button>
          <button type="button" class="button outlined" data-action="col" title="Добавить столбец справа">Столбец +</button>
          <button type="button" class="button ghost" data-action="drop-row">Удалить строку</button>
          <button type="button" class="button ghost" data-action="drop-col">Удалить столбец</button>
        </div>`;
    if (draft.mode === 'text') this.toolbar.insertAdjacentHTML('beforeend', `
      <label>Ширина, мм <input name="text-width" type="number" min="1" step="1" aria-label="Ширина текстового поля, мм"></label>
      <button type="button" class="button outlined" data-action="expand-text" title="Расширить поле до правого края страницы">Расширить поле</button>`);
    this.toolbar.insertAdjacentHTML('beforeend', `
      <label class="shift-control"><input name="shift" type="checkbox" checked>Сдвигать содержимое ниже</label>
      <button type="button" class="button outlined" data-action="retry-font" hidden>Повторить загрузку шрифта</button>
      <button type="button" class="button primary" data-action="apply">Готово</button>
      <button type="button" class="icon-button" data-action="cancel" title="Отменить правку (Esc)" aria-label="Отменить правку">${icon('close')}</button>`);
    this.toolbar.querySelector('[name="shift"]').checked = draft.shift;
    this.toolbar.querySelector('[name="shift"]').disabled = !!draft.scanCover;
    this.toolbar.querySelector('[name="font"]').value = draft.font;
    if (draft.mode === 'text') {
      this.toolbar.querySelector('[name="size"]').value = Math.round(draft.size * 10) / 10;
      this.toolbar.querySelector('[name="color"]').value = draft.color;
    }
    this.prepareFont();
  }

  prepareFont() {
    const draft = this.draft;
    const { font } = draft;
    const action = this.toolbar.querySelector('[data-action="apply"]');
    const retry = this.toolbar.querySelector('[data-action="retry-font"]');
    const request = {};
    const current = () => this.draft === draft && draft.fontRequest === request;
    draft.fontRequest = request;
    draft.fontReady = false;
    action.disabled = true;
    action.title = 'Загрузка шрифта…';
    retry.hidden = true;
    const prepare = async () => {
      try { await this.loadFont(font); }
      catch (error) {
        if (!current()) return;
        const fallback = officeAliases[font] ?? 'Noto Sans';
        if (fallback === font) throw error;
        await this.loadFont(fallback);
        if (!current()) return;
        draft.font = fallback;
        this.toolbar.querySelector('[name="font"]').value = fallback;
        this.message(`Шрифт ${font} не загрузился. Для сохранения подключён ${fallback}.`);
      }
    };
    prepare().then(() => {
      if (!current()) return;
      draft.fontReady = true;
      action.disabled = false;
      action.title = '';
      this.updateDraft();
    }).catch(() => {
      if (!current()) return;
      action.title = 'Повторите загрузку шрифта или выберите другой.';
      retry.hidden = false;
      this.message('Не удалось загрузить шрифт. Повторите загрузку или выберите другой. Правка остаётся в сессии.', true);
    });
  }

  openTableStyle(force) {
    const button = this.toolbar.querySelector('[data-action="table-style"]');
    this.stylebar.hidden = force === undefined ? !this.stylebar.hidden : !force;
    button.setAttribute('aria-pressed', String(!this.stylebar.hidden));
    if (this.stylebar.hidden) return;
    if (!this.stylebar.childElementCount) {
      this.stylebar.innerHTML = `<div class="table-style-group">
        <label>Границы для<select name="border-scope" aria-label="Границы для"><option value="table">Всей таблицы</option><option value="outer">Внешнего контура</option><option value="inner">Внутренней сетки</option><option value="cell">Выбранной ячейки</option></select></label>
        <label>Тип линии<select name="border-pattern" aria-label="Тип линии">${borderPatterns.map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}</select></label>
        <label>Толщина, пт<input name="border-width" type="number" step=".25" min=".25" max="8" aria-label="Толщина границы"></label>
        <label>Цвет линии<input name="border-color" type="color" aria-label="Цвет границы"></label>
      </div>
      <div class="table-style-group">
        <label>Цвет ячейки<input name="cell-color" aria-label="Цвет ячейки" type="color"></label>
        <button type="button" class="button outlined" data-action="fill-cell">Залить ячейку</button>
        <button type="button" class="button ghost" data-action="clear-fill">Без заливки</button>
      </div>`;
    }
    this.syncTableStyle();
  }

  syncTableStyle() {
    if (this.stylebar.hidden || this.draft.mode !== 'table') return;
    const { style, row, col, borderScope } = this.draft;
    const cell = style.cells[row][col];
    const border = borderScope === 'cell' ? cell.border ?? style.inner : borderScope === 'inner' ? style.inner : style.outer;
    for (const [name, value] of Object.entries({
      'border-scope': borderScope, 'border-pattern': border.pattern, 'border-width': border.width,
      'border-color': border.color, 'cell-color': cell.fill ?? this.fillColor,
    })) {
      this.stylebar.querySelector(`[name="${name}"]`).value = value;
    }
  }

  styleInput(event) {
    const draft = this.draft;
    if (draft?.mode !== 'table') return;
    const { name, value } = event.target;
    if (name === 'cell-color') {
      this.fillColor = value;
      return;
    }
    if (name === 'border-scope') {
      draft.borderScope = value;
      this.syncTableStyle();
      return;
    }
    const width = this.stylebar.querySelector('[name="border-width"]').valueAsNumber;
    if (!Number.isFinite(width) || width < .25 || width > 8) return;
    const color = this.stylebar.querySelector('[name="border-color"]').value;
    const pattern = this.stylebar.querySelector('[name="border-pattern"]').value;
    const border = { width, color, pattern };
    const { style, row, col, borderScope } = draft;
    if (borderScope === 'table') {
      style.inner = border;
      style.outer = border;
      for (const cell of style.cells.flat()) {
        delete cell.border;
        delete cell.order;
      }
    } else if (borderScope === 'cell') {
      const cell = style.cells[row][col];
      cell.border = border;
      cell.order = ++style.serial;
    } else style[borderScope] = border;
    draft.dirty = true;
    this.updateDraft();
  }

  measure(text, bold) {
    const { font, size } = this.draft;
    this.measurer.font = `${this.draft.italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px "${font}"`;
    return this.measurer.measureText(text).width;
  }

  plan() {
    const draft = this.draft;
    if (!draft) return null;
    if (draft.mode === 'text') {
      const lineHeight = draft.lineHeight * draft.size / draft.originalSize;
      const lines = draft.text.trim() ? wrapText(draft.text, draft.width - 2, value => this.measure(value, draft.bold)) : [];
      const baseline = draft.baseline + (draft.size - draft.originalSize) * .76;
      const oldSpace = draft.rows ? (draft.rows - 1) * draft.lineHeight + draft.originalSize : 0;
      const newSpace = lines.length ? (lines.length - 1) * lineHeight + draft.size : 0;
      return { ...draft, lineHeight, lines, baseline, color: [...colorArray(draft.color).slice(0, 3), draft.alpha ?? 255], delta: draft.dirty && draft.shift ? newSpace - oldSpace + draft.baseline - (draft.originalBaseline ?? draft.baseline) : 0 };
    }
    const lines = draft.rows.map((row, rowIndex) => row.map((value, colIndex) => wrapText(value, draft.widths[colIndex] - 12,
      text => this.measure(text, draft.boldHeader && !rowIndex))));
    const heights = lines.map((row, rowIndex) => Math.max(draft.heights[rowIndex], 13 + draft.size * 1.24 * Math.max(...row.map(lines => lines.length))));
    const delta = draft.shift && draft.dirty ? sum(heights) - draft.h : 0;
    return { ...draft, lines, heights, delta };
  }

  preview() {
    if (!this.draft) return null;
    const { indices, after, delta } = this.plan();
    return { indices, after, delta };
  }

  updateDraft() {
    this.changed();
    this.position();
    const delta = this.plan().delta;
    if (this.lastDelta === delta) return;
    this.lastDelta = delta;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.draft) this.render();
    });
  }

  position() {
    if (!this.draft || !this.layer.firstElementChild) return;
    const plan = this.plan();
    const scale = this.layer.clientWidth / this.getPage().pageWidth;
    if (!scale) return;
    if (plan.mode === 'text') {
      const node = this.layer.firstElementChild;
      const size = plan.size * scale;
      // Align the textarea's first baseline to the native PDF text baseline.
      const line = plan.lineHeight * scale;
      const offset = this.measureBaseline(line, size, plan.font, plan.bold);
      Object.assign(node.style, {
        left: `${plan.x * scale}px`, top: `${plan.baseline * scale - offset}px`,
        width: `${(plan.width + 2) * scale}px`, minHeight: `${line}px`,
        height: `${Math.max(1, plan.lines.length) * line + 3}px`, fontFamily: plan.font,
        fontSize: `${size}px`, fontWeight: plan.bold ? '700' : '400', fontStyle: plan.italic ? 'italic' : 'normal',
        textDecorationLine: [plan.underline && 'underline', plan.strike && 'line-through'].filter(Boolean).join(' ') || 'none',
        lineHeight: `${line}px`, color: this.draft.color, backgroundColor: plan.scanCover?.color ?? 'transparent',
      });
      const left = parseFloat(node.style.left), top = parseFloat(node.style.top);
      const width = parseFloat(node.style.width), height = parseFloat(node.style.height);
      Object.assign(this.layer.querySelector('.text-grip').style, { left: `${left}px`, top: `${Math.max(0, top - 26)}px` });
      Object.assign(this.layer.querySelector('.text-resize').style, { left: `${left + width - 5}px`, top: `${top + height / 2 - 12}px` });
      const field = this.toolbar.querySelector('[name="text-width"]');
      if (document.activeElement !== field) field.value = String(Math.round(plan.width / pointsPerMillimeter * 10) / 10);
      field.max = String(Math.floor((this.getPage().pageWidth - plan.x - 3) / pointsPerMillimeter));
      const mask = this.layer.querySelector('.scan-edit-mask');
      const box = mask && this.scanRect(plan.scanCover);
      if (box) Object.assign(mask.style, {
        left: `${(box.x * this.getPage().pageWidth - 1) * scale}px`, top: `${(box.y * this.getPage().pageHeight - .65) * scale}px`,
        width: `${(box.w * this.getPage().pageWidth + 2) * scale}px`, height: `${(box.h * this.getPage().pageHeight + 1.3) * scale}px`,
        background: plan.scanCover.color,
      });
      return;
    }
    const table = this.layer.firstElementChild;
    Object.assign(table.style, { left: `${plan.x * scale}px`, top: `${plan.y * scale}px`, fontSize: `${plan.size * scale}px`, fontFamily: plan.font });
    const grid = table.querySelector('.inline-grid');
    grid.style.gridTemplateColumns = plan.widths.map(value => `${value * scale}px`).join(' ');
    grid.style.gridTemplateRows = plan.heights.map(value => `${value * scale}px`).join(' ');
    grid.style.setProperty('--cell-padding-x', `${6 * scale}px`);
    grid.style.setProperty('--cell-padding-y', `${5 * scale}px`);
    for (const cell of grid.children) {
      const [row, col] = cell.dataset.cell.split(':').map(Number);
      cell.style.setProperty('--cell-fill', plan.style.cells[row][col].fill ?? 'transparent');
      cell.style.borderTop = borderCSS(edgeStyle(plan.style, 'h', row, col), scale);
      cell.style.borderLeft = borderCSS(edgeStyle(plan.style, 'v', row, col), scale);
      cell.style.borderBottom = row === plan.rows.length - 1 ? borderCSS(edgeStyle(plan.style, 'h', row + 1, col), scale) : 'none';
      cell.style.borderRight = col === plan.widths.length - 1 ? borderCSS(edgeStyle(plan.style, 'v', row, col + 1), scale) : 'none';
    }
  }

  measureBaseline(line, size, font, bold) {
    this.measurer.font = `${this.draft.italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px "${font}"`;
    const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = this.measurer.measureText('Яр');
    return Number.isFinite(ascent) ? (line + ascent - descent) / 2 : line * .78;
  }

  renderTable() {
    const { rows, boldHeader } = this.draft;
    const table = document.createElement('div');
    table.className = 'inline-table';
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'table-grip';
    grip.title = 'Перетащите, чтобы переместить таблицу';
    grip.setAttribute('aria-label', 'Переместить таблицу');
    grip.innerHTML = icon('move');
    const grid = document.createElement('div');
    grid.className = 'inline-grid';
    rows.forEach((row, rowIndex) => row.forEach((value, colIndex) => {
      const cell = document.createElement('textarea');
      cell.className = 'inline-cell';
      if (!rowIndex && boldHeader) cell.classList.add('bold');
      cell.rows = 1;
      cell.maxLength = 3000;
      cell.setAttribute('aria-label', `Ячейка ${rowIndex + 1}, ${colIndex + 1}`);
      cell.dataset.cell = `${rowIndex}:${colIndex}`;
      cell.spellcheck = false;
      cell.value = value;
      grid.append(cell);
    }));
    table.append(grip, grid);
    this.layer.replaceChildren(table);
    this.position();
    this.activeCell();
    this.toolbar.querySelector('[data-action="drop-row"]').disabled = rows.length <= 1;
    this.toolbar.querySelector('[data-action="drop-col"]').disabled = rows[0].length <= 1;
    this.toolbar.querySelector('[data-action="row"]').disabled = rows.length >= maxRows;
    this.toolbar.querySelector('[data-action="col"]').disabled = rows[0].length >= maxColumns;
  }

  activeCell(focus = false) {
    if (this.draft?.mode !== 'table') return;
    this.layer.querySelector('.inline-cell.active')?.classList.remove('active');
    const cell = this.layer.querySelector(`[data-cell="${this.draft.row}:${this.draft.col}"]`);
    cell?.classList.add('active');
    if (focus) cell?.focus({ preventScroll: true });
  }

  focusCell(event) {
    if (!event.target.dataset.cell) return;
    [this.draft.row, this.draft.col] = event.target.dataset.cell.split(':').map(Number);
    this.activeCell();
    this.syncTableStyle();
  }

  input(event) {
    const draft = this.draft;
    if (!draft) return;
    if (draft.mode === 'text') draft.text = event.target.value;
    else if (event.target.dataset.cell) {
      const [row, col] = event.target.dataset.cell.split(':').map(Number);
      draft.rows[row][col] = event.target.value;
    }
    draft.dirty = true;
    this.updateDraft();
  }

  format(event) {
    const draft = this.draft;
    if (!draft) return;
    const { name, value, checked, valueAsNumber } = event.target;
    if (name === 'text-width') { this.resizeTo(valueAsNumber * pointsPerMillimeter); return; }
    if (name === 'shift') draft.shift = checked;
    if (name === 'font' || name === 'color') draft[name] = value;
    if (name === 'font') this.prepareFont();
    if (name === 'size') {
      if (!Number.isFinite(valueAsNumber) || valueAsNumber < 1 || valueAsNumber > 120) return;
      draft.size = valueAsNumber;
    }
    if (name !== 'shift') draft.dirty = true;
    this.updateDraft();
  }

  action(event) {
    const button = event.target.closest('[data-action]');
    const draft = this.draft;
    if (!button || !draft) return;
    switch (button.dataset.action) {
      case 'apply': this.finish(); return;
      case 'table-style': this.openTableStyle(); return;
      case 'fill-cell': case 'clear-fill': {
        const cell = draft.style.cells[draft.row][draft.col];
        if (button.dataset.action === 'fill-cell') cell.fill = this.stylebar.querySelector('[name="cell-color"]').value;
        else delete cell.fill;
        draft.dirty = true;
        this.syncTableStyle();
        this.updateDraft();
        return;
      }
      case 'retry-font': this.prepareFont(); return;
      case 'expand-text': this.resizeTo(this.getPage().pageWidth - draft.x - 3); return;
      case 'cancel': this.cancel(); return;
      case 'bold': case 'italic': case 'underline': case 'strike': {
        const name = button.dataset.action;
        draft[name] = !draft[name];
        button.setAttribute('aria-pressed', draft[name]);
        draft.dirty = true;
        this.updateDraft();
        return;
      }
      case 'row':
        draft.rows.splice(++draft.row, 0, Array(draft.widths.length).fill(''));
        draft.heights.splice(draft.row, 0, 26);
        draft.style.cells.splice(draft.row, 0, Array.from({ length: draft.widths.length }, () => ({})));
        break;
      case 'col': {
        const total = sum(draft.widths);
        const minimum = 20;
        const width = Math.min(100, Math.max(28, total / (draft.widths.length + 1)), total - draft.widths.length * minimum);
        if (width < minimum) {
          this.message('Для нового столбца нужна более широкая таблица.', true);
          return;
        }
        const available = total - width - draft.widths.length * minimum;
        const weight = sum(draft.widths.map(old => Math.max(1, old - minimum)));
        draft.widths = draft.widths.map(old => minimum + available * Math.max(1, old - minimum) / weight);
        draft.widths.splice(++draft.col, 0, width);
        draft.rows.forEach(row => row.splice(draft.col, 0, ''));
        draft.style.cells.forEach(row => row.splice(draft.col, 0, {}));
        break;
      }
      case 'drop-row':
        draft.rows.splice(draft.row, 1);
        draft.style.cells.splice(draft.row, 1);
        draft.heights.splice(draft.row, 1);
        draft.row = Math.min(draft.row, draft.rows.length - 1);
        break;
      case 'drop-col': {
        const [width] = draft.widths.splice(draft.col, 1);
        const rest = sum(draft.widths);
        draft.widths = draft.widths.map(old => old * (1 + width / rest));
        draft.rows.forEach(row => row.splice(draft.col, 1));
        draft.style.cells.forEach(row => row.splice(draft.col, 1));
        draft.col = Math.min(draft.col, draft.widths.length - 1);
        break;
      }
      default: return;
    }
    draft.dirty = true;
    this.renderTable();
    this.activeCell(true);
    this.updateDraft();
  }

  key(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.finish();
    } else if (event.target.closest('.table-grip, .text-grip, .text-resize') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      const step = event.shiftKey ? 12 : 2;
      if (event.target.closest('.text-resize')) this.resizeTo(this.draft.width + dx * step);
      else this.moveTo(this.draft.x + dx * step, this.draft.y + dy * step);
    }
  }

  grab(event) {
    const button = event.target.closest('.table-grip, .text-grip, .text-resize');
    if (!button || event.button !== 0) return;
    event.preventDefault();
    button.focus({ preventScroll: true });
    button.setPointerCapture(event.pointerId);
    this.dragStart = { x: event.clientX, y: event.clientY, left: this.draft.x, top: this.draft.y, width: this.draft.width, resize: button.classList.contains('text-resize') };
  }

  drag(event) {
    if (!this.dragStart) return;
    const start = this.dragStart;
    const scale = this.layer.clientWidth / this.getPage().pageWidth;
    if (start.resize) this.resizeTo(start.width + (event.clientX - start.x) / scale);
    else this.moveTo(start.left + (event.clientX - start.x) / scale, start.top + (event.clientY - start.y) / scale);
  }

  moveTo(x, y) {
    const page = this.getPage();
    const draft = this.draft;
    if (draft.mode === 'text') {
      const plan = this.plan();
      moveTextBox(draft, x, y, page, Math.max(1, plan.lines.length) * plan.lineHeight);
      this.updateDraft(); return;
    }
    draft.x = Math.max(3, Math.min(x, page.pageWidth - sum(draft.widths) - 3));
    draft.y = Math.max(3, Math.min(y, page.pageHeight - 30));
    draft.dirty = true;
    this.changed();
    this.position();
  }

  finish() {
    const draft = this.draft;
    if (!draft) return true;
    if (!draft.dirty || draft.mode === 'text' && !draft.indices.length && !draft.text.trim()) {
      this.cancel();
      return true;
    }
    if (!draft.fontReady) {
      this.message('Дождитесь загрузки шрифта или выберите другой.', true);
      return false;
    }
    const plan = this.plan();
    this.draft = null;
    if (!this.commit(plan)) {
      this.draft = draft;
      this.updateDraft();
      return false;
    }
    this.close();
    return true;
  }

  cancel() {
    if (!this.draft) return;
    this.draft = null;
    this.close();
    this.render();
  }

  close() {
    this.changed();
    this.layer.hidden = true;
    this.toolbar.hidden = true;
    this.stylebar.hidden = true;
    this.layer.replaceChildren();
    this.toolbar.replaceChildren();
  }
}
