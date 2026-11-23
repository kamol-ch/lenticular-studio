// App shell: wizard navigation, sidebar status, project open/save.

import { store } from './store.js';
import { h, clear, button, toast, downloadBlob, pickFiles, progress, more } from './ui.js';
import { defaultState } from './core/schema.js';
import { saveProject, loadProject } from './project-io.js';
import { createStage } from './stage.js';
import { startAutosave, loadAutosave, clearAutosave } from './autosave.js';
import step1 from './steps/s1-lens.js';
import step2, { planFor } from './steps/s2-plan.js';
import { openAskAI } from './ask-ai.js';
import step3 from './steps/s3-images.js';
import step4 from './steps/s4-animation.js';
import step5 from './steps/s5-depth.js';
import step6 from './steps/s6-interlace.js';
import step7 from './steps/s7-print.js';

const STEPS = [step1, step2, step3, step4, step5, step6, step7];

const nav = document.getElementById('steps');
const main = document.getElementById('main');
const framesBadge = document.getElementById('frames-status');
const nameInput = document.getElementById('project-name');

let current = 1;
let cleanup = null;

const STATUS_LABEL = { todo: '', done: 'Done', skipped: 'Skipped' };

function renderNav() {
  clear(nav);
  for (const s of STEPS) {
    const status = store.state.steps[s.id];
    nav.append(h('li', {},
      h('a', {
        href: `#step-${s.id}`, class: `step-link ${s.id === current ? 'active' : ''} st-${status}`,
        'aria-current': s.id === current ? 'step' : null,
      },
      h('span', { class: 'step-num' }, status === 'done' ? '✓' : s.id),
      h('span', { class: 'step-text' }, h('span', { class: 'step-title' }, s.title),
        h('span', { class: 'step-sub' }, STATUS_LABEL[status] || (s.optional ? 'Optional' : s.subtitle))))));
  }
  const fs = store.framesStatus();
  framesBadge.textContent = fs.text;
  framesBadge.className = `frames-status ${fs.ok ? 'ok' : fs.stale ? 'stale' : ''}`;
  if (document.activeElement !== nameInput) nameInput.value = store.state.name;
}

// ---------- editor shell (canvas + inspector) ----------
const editorEl = document.getElementById('editor');
const inspectorEl = document.getElementById('inspector');
const toolsEl = document.getElementById('stage-tools');
const stripEl = document.getElementById('stage-strip');
const viewEl = document.getElementById('stage-view');
let stage = null;
let zoomLabel = null, guidesBtn = null;

function ensureStage() {
  if (stage) return stage;
  stage = createStage(document.getElementById('stage'), {
    onView: (st) => {
      if (zoomLabel) zoomLabel.textContent = `${st.zoomPercent}%`;
      if (guidesBtn) { guidesBtn.classList.toggle('on', st.guides); guidesBtn.setAttribute('aria-pressed', st.guides); }
    },
  });
  guidesBtn = h('button', { type: 'button', class: 'btn small toggle', title: 'Show or hide guides and labels on the canvas', onclick: () => stage.setGuides(!stage.guides) }, 'Guides');
  zoomLabel = h('span', { class: 'zoom-label', title: '100% = actual size on a typical screen' }, '100%');
  viewEl.append(
    guidesBtn,
    h('button', { type: 'button', class: 'btn small', 'aria-label': 'Zoom out', onclick: () => stage.zoomBy(0.8) }, '−'),
    zoomLabel,
    h('button', { type: 'button', class: 'btn small', 'aria-label': 'Zoom in', onclick: () => stage.zoomBy(1.25) }, '+'),
    h('button', { type: 'button', class: 'btn small', title: 'Fit to window (double-click the canvas)', onclick: () => stage.fit() }, 'Fit'),
  );
  stage.setGuides(stage.guides);
  showCoach();
  return stage;
}

/** One-time hint about moving around the canvas. */
function showCoach() {
  const KEY = 'lenticular-studio:coach';
  try { if (localStorage.getItem(KEY)) return; } catch { return; }
  const host = document.getElementById('stage');
  const box = h('div', { class: 'coach', role: 'note' },
    h('strong', {}, 'Moving around'),
    h('span', {}, 'Scroll to zoom · drag the background to pan · double-click to fit · Guides hides the labels'),
    h('button', { type: 'button', class: 'btn small primary', onclick: () => { box.remove(); try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } } }, 'Got it'));
  host.append(box);
}

function stepNav(step) {
  const prev = current > 1 ? button('← Back', () => go(current - 1), { kind: 'ghost' }) : h('span');
  const skip = step.optional ? button('Skip', () => { store.setStep(step.id, 'skipped'); go(current + 1); }, { kind: 'ghost' }) : null;
  const next = current < STEPS.length
    ? button('Done, next →', () => { store.setStep(step.id, 'done'); go(current + 1); }, { kind: 'primary' })
    : button('Mark done', () => { store.setStep(step.id, 'done'); toast('All steps complete. Enjoy your card!'); }, { kind: 'primary' });
  return [prev, h('div', { class: 'spacer' }), skip, next];
}

function renderStep() {
  cleanup?.();
  cleanup = null;
  clear(main);
  const step = STEPS[current - 1];
  const isEditor = typeof step.editor === 'function';
  main.hidden = isEditor;
  editorEl.hidden = !isEditor;
  document.body.classList.toggle('editing', isEditor);

  if (isEditor) {
    clear(inspectorEl); clear(toolsEl); clear(stripEl);
    stripEl.hidden = true;
    const body = h('div', { class: 'insp-body' });
    inspectorEl.append(
      h('header', { class: 'insp-head' },
        h('p', { class: 'eyebrow' }, `Step ${step.id} of ${STEPS.length}`), h('h2', {}, step.title),
        step.intro ? h('p', { class: 'lead' }, step.intro) : null,
        step.details ? more(...step.details) : null),
      body,
      h('footer', { class: 'insp-foot' }, ...stepNav(step)),
    );
    const st = ensureStage();
    cleanup = step.editor({ ...app, stage: st, inspector: body, tools: toolsEl, strip: stripEl }) || null;
    inspectorEl.scrollTop = 0;
    // The strip may have appeared or gone without the observer noticing a size change.
    requestAnimationFrame(() => st.resize());
    return;
  }

  const body = h('div', { class: 'step-body' });
  main.append(
    h('header', { class: 'step-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, `Step ${step.id} of ${STEPS.length}`), h('h2', {}, step.title), step.intro ? h('p', { class: 'lead' }, step.intro) : null)),
    step.details ? h('div', { class: 'step-guide' }, more(...step.details)) : null,
    body,
    h('footer', { class: 'step-foot' }, ...stepNav(step)),
  );
  cleanup = step.render(body, app) || null;
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function go(n) {
  n = Math.max(1, Math.min(STEPS.length, n));
  if (location.hash !== `#step-${n}`) location.hash = `#step-${n}`;
  else route();
}

function route() {
  const m = /#step-(\d)/.exec(location.hash);
  current = m ? Math.max(1, Math.min(STEPS.length, Number(m[1]))) : 1;
  renderNav();
  renderStep();
}

const app = { store, go, rerender: renderStep };

store.on('change', renderNav);
store.on('assets', renderNav);
window.addEventListener('hashchange', route);

nameInput.addEventListener('change', () => store.update((s) => { s.name = nameInput.value.trim() || 'Untitled card'; }));

const headerProgress = progress();
document.getElementById('header-progress').append(headerProgress);

const slug = () => store.state.name.trim().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';

document.getElementById('btn-save').append(button('Save project', async () => {
  const blob = await saveProject((p, l) => headerProgress.set(p, l));
  headerProgress.done();
  downloadBlob(blob, `${slug()}.zip`);
  store.dirty = false;
  toast('Project saved.');
}, { kind: 'primary' }));

document.getElementById('btn-open').append(button('Open…', async () => {
  const [file] = await pickFiles({ accept: '.zip,application/zip' });
  if (!file) return;
  if (store.dirty && !confirm('Discard unsaved images and frames in the current project?')) return;
  await loadProject(file, (p, l) => headerProgress.set(p, l));
  headerProgress.done();
  toast(`Opened ${file.name}`);
  route();
}, { kind: 'ghost' }));

document.getElementById('btn-new').append(button('New', () => {
  if (store.dirty && !confirm('Start a new project? Unsaved images and frames will be lost.')) return;
  const keep = store.state;
  const fresh = defaultState();
  // Keep the Step 1 calibration (and the last card size, which is often reused).
  fresh.printer = keep.printer; fresh.media = keep.media; fresh.lens = keep.lens; fresh.tests = keep.tests; fresh.card = keep.card;
  store.replaceAll(fresh, {});
  clearAutosave();
  go(1);
  route();
}, { kind: 'ghost', title: 'New project (keeps your lens calibration)' }));

window.addEventListener('beforeunload', (e) => {
  if (!store.autosaved) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- undo / redo ----------
const undoBtn = h('button', { type: 'button', class: 'btn ghost', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo' }, '↶');
const redoBtn = h('button', { type: 'button', class: 'btn ghost', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo' }, '↷');
const doUndo = () => { if (store.undo()) renderStep(); };
const doRedo = () => { if (store.redo()) renderStep(); };
undoBtn.addEventListener('click', doUndo);
redoBtn.addEventListener('click', doRedo);
document.getElementById('btn-undo').append(undoBtn);

// One "Ask AI" entry point: it opens the user's own AI with this step and the settings.
document.getElementById('btn-ask').append(button('Ask AI', () => {
  const step = STEPS[current - 1];
  const state = store.state;
  let plan = null;
  try { plan = planFor(state); } catch { /* incomplete state: settings only */ }
  const shown = [...document.querySelectorAll('#inspector .warnings li, #main .warnings li')].map((li) => li.textContent);
  openAskAI({ step: { id: step.id, title: step.title }, state, plan, warnings: [...shown, ...(plan?.warnings || []).map((w) => w.text)] });
}, { kind: 'ghost', title: 'Ask an AI assistant about this step, with your settings' }));
document.getElementById('btn-redo').append(redoBtn);
const refreshHistory = () => { undoBtn.disabled = !store.canUndo; redoBtn.disabled = !store.canRedo; };
store.on('history', refreshHistory);
refreshHistory();
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio'].includes(t.type)) || t.tagName === 'TEXTAREA')) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doRedo(); }
});

// ---------- autosave ----------
const autosaveEl = document.getElementById('autosave-status');
startAutosave(store, (text) => { autosaveEl.textContent = text; });

loadAutosave(store)
  .then((restored) => { if (restored) { store.clearHistory(); toast('Restored your last session.'); } })
  .catch((e) => console.warn('No autosave restored', e))
  .finally(route);
