// Tiny DOM helpers and form controls.

import { ART } from './art.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function card(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h3', {}, title) : null, ...children);
}

export function row(...children) { return h('div', { class: 'row' }, ...children); }

export function hint(text) { return h('p', { class: 'hint' }, text); }

let fieldId = 0;

export function numberField({ label, value, step = 'any', min, max, unit, onChange, hint: hintText, placeholder, disabled }) {
  const id = `f${++fieldId}`;
  const input = h('input', { id, type: 'number', step, min, max, placeholder, disabled, value: value ?? '' });
  input.addEventListener('change', () => {
    const v = input.value === '' ? null : Number(input.value);
    if (v != null && !Number.isFinite(v)) return;
    onChange?.(v, input);
  });
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('div', { class: 'input-unit' }, input, unit ? h('span', { class: 'unit' }, unit) : null),
    hintText ? h('small', {}, hintText) : null);
}

export function textField({ label, value, onChange, placeholder }) {
  const id = `f${++fieldId}`;
  const input = h('input', { id, type: 'text', value: value ?? '', placeholder });
  input.addEventListener('change', () => onChange?.(input.value));
  return h('div', { class: 'field' }, h('label', { for: id }, label), input);
}

export function selectField({ label, value, options, onChange, hint: hintText }) {
  const id = `f${++fieldId}`;
  const sel = h('select', { id }, options.map((o) => {
    const [v, t] = Array.isArray(o) ? o : [o.value, o.label];
    return h('option', { value: v, selected: String(v) === String(value) }, t);
  }));
  sel.addEventListener('change', () => onChange?.(sel.value, sel));
  return h('div', { class: 'field' }, label ? h('label', { for: id }, label) : null, sel, hintText ? h('small', {}, hintText) : null);
}

export function checkbox({ label, checked, onChange, hint: hintText }) {
  const input = h('input', { type: 'checkbox', checked: !!checked });
  input.addEventListener('change', () => onChange?.(input.checked, input));
  return h('label', { class: 'check' }, input, h('span', {}, label, hintText ? h('small', {}, hintText) : null));
}

export function slider({ label, value, min, max, step = 0.01, onInput, onChange, format = (v) => v }) {
  const id = `f${++fieldId}`;
  const out = h('output', { for: id }, format(value));
  const input = h('input', { id, type: 'range', min, max, step, value });
  input.addEventListener('input', () => { out.textContent = format(Number(input.value)); onInput?.(Number(input.value)); });
  input.addEventListener('change', () => onChange?.(Number(input.value)));
  const el = h('div', { class: 'field slider' }, h('label', { for: id }, label, ' ', out), input);
  el.input = input;
  el.set = (v) => { input.value = v; out.textContent = format(v); };
  return el;
}

export function radios({ name, value, options, onChange }) {
  return h('div', { class: 'segmented', role: 'radiogroup' }, options.map(([v, t, desc]) => {
    const input = h('input', { type: 'radio', name, value: v, checked: v === value });
    input.addEventListener('change', () => input.checked && onChange?.(v));
    return h('label', { title: desc || null }, input, h('span', {}, t));
  }));
}

export function button(text, onClick, { kind = '', disabled = false, title } = {}) {
  const b = h('button', { type: 'button', class: `btn ${kind}`.trim(), disabled, title }, text);
  b.addEventListener('click', async (e) => {
    if (b.disabled) return;
    b.disabled = true;
    b.classList.add('busy');
    try { await onClick?.(e); }
    catch (err) { console.error(err); toast(err.message || String(err), 'error'); }
    finally { b.disabled = false; b.classList.remove('busy'); }
  });
  return b;
}

export function warnings(list) {
  if (!list?.length) return null;
  return h('ul', { class: 'warnings' }, list.map((w) => h('li', { class: `w-${w.level || 'warn'}` }, w.text)));
}

export function progress() {
  const bar = h('div', { class: 'progress', hidden: true }, h('div', { class: 'progress-fill' }), h('span', { class: 'progress-label' }));
  bar.set = (fraction, label = '') => {
    bar.hidden = false;
    bar.firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    bar.lastChild.textContent = label;
  };
  bar.done = () => { bar.hidden = true; };
  return bar;
}

export function toast(message, type = 'info') {
  const host = document.getElementById('toasts');
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  host.append(el);
  setTimeout(() => el.classList.add('out'), type === 'error' ? 6000 : 3000);
  setTimeout(() => el.remove(), type === 'error' ? 6500 : 3500);
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadJson(obj, name) {
  downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), name);
}

export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export async function readJsonFile(file) {
  return JSON.parse(await file.text());
}

export function dropZone({ accept, multiple = true, onFiles, label }) {
  const z = h('div', { class: 'dropzone', tabindex: 0, role: 'button' }, label);
  const pick = async () => { const files = await pickFiles({ accept, multiple }); if (files.length) onFiles(files); };
  z.addEventListener('click', pick);
  z.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', (e) => {
    e.preventDefault(); z.classList.remove('over');
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(files);
  });
  return z;
}

export const fmt = {
  px: (v) => `${Math.round(v).toLocaleString()} px`,
  mm: (v) => `${(+v).toFixed(1)} mm`,
  n: (v, d = 2) => (+v).toFixed(d),
  bytes: (b) => (b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`),
};

export function stat(label, value) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value));
}

// ---------- visual guidance ----------

/** An illustration by name; "name:a:b" passes a and b as arguments. */
export function art(spec) {
  const [name, ...args] = spec.split(':');
  return h('div', { class: 'art-wrap', html: ART[name](...args) });
}

/** Numbered picture strip: items = [artName, title, caption?]. */
export function guide(items) {
  return h('ol', { class: 'guide' }, items.map(([name, title, text], i) => h('li', { class: 'guide-item' },
    art(name),
    h('div', { class: 'guide-cap' },
      h('span', { class: 'guide-n' }, i + 1),
      h('div', {}, h('strong', {}, title), text ? h('span', {}, text) : null)))));
}

/** Expandable box for the detail most people can skip. */
export function more(...children) {
  return h('details', { class: 'more' },
    h('summary', {}, 'More detail'),
    h('div', { class: 'more-body' }, children.flat().map((c) => (typeof c === 'string' ? h('p', {}, c) : c))));
}

/** One short line, with optional detail behind "More detail". */
export function tip(short, ...detail) {
  return h('div', { class: 'tip' }, h('p', { class: 'hint' }, short), detail.length ? more(...detail) : null);
}
