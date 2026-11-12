// App shell: wizard navigation, sidebar status, project open/save.

import { store } from './store.js';
import { h, clear, button, toast, downloadBlob, pickFiles, progress } from './ui.js';
import { defaultState } from './core/schema.js';
import { saveProject, loadProject } from './project-io.js';
import step1 from './steps/s1-lens.js';
import step2 from './steps/s2-plan.js';
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

function renderStep() {
  cleanup?.();
  cleanup = null;
  clear(main);
  const step = STEPS[current - 1];
  const body = h('div', { class: 'step-body' });
  const prev = current > 1 ? button('← Back', () => go(current - 1), { kind: 'ghost' }) : h('span');
  const skip = step.optional ? button('Skip', () => { store.setStep(step.id, 'skipped'); go(current + 1); }, { kind: 'ghost' }) : null;
  const next = current < STEPS.length
    ? button('Done, next →', () => { store.setStep(step.id, 'done'); go(current + 1); }, { kind: 'primary' })
    : button('Mark done', () => { store.setStep(step.id, 'done'); toast('All steps complete. Enjoy your card!'); }, { kind: 'primary' });

  main.append(
    h('header', { class: 'step-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, `Step ${step.id} of ${STEPS.length}`), h('h2', {}, step.title), step.intro ? h('p', { class: 'lead' }, step.intro) : null)),
    body,
    h('footer', { class: 'step-foot' }, prev, h('div', { class: 'spacer' }), skip, next),
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
  // Keep calibration: lens, printer and card usually stay the same between cards.
  fresh.lens = keep.lens; fresh.printer = keep.printer; fresh.card = keep.card; fresh.tests = keep.tests; fresh.effect = keep.effect;
  store.replaceAll(fresh, {});
  go(1);
  route();
}, { kind: 'ghost', title: 'New project (keeps your lens calibration)' }));

window.addEventListener('beforeunload', (e) => {
  if (store.dirty) { e.preventDefault(); e.returnValue = ''; }
});

route();
