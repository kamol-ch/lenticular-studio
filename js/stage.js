// The editor canvas: a zoomable, pannable view of a scene drawn in millimetres.
//
// A scene is { bounds() → {x,y,w,h} in mm, draw(ctx, v), pointerDown?(pt, e) → handler|falsy,
// hover?(pt) → cursor }. While drawing, ctx is transformed so 1 unit = 1 mm.
// `v` carries: px (mm per CSS pixel, for hairlines), k (CSS px per mm), guides,
// colors, visible (world rect on screen) and text() for crisp screen-space labels.

import { h } from './ui.js';

const LS_GUIDES = 'lenticular-studio:guides';

export function createStage(host, { onView } = {}) {
  const canvas = h('canvas', { class: 'stage-canvas', tabindex: 0, 'aria-label': 'Card canvas. Scroll to zoom, drag the background to pan, double-click to fit.' });
  host.append(canvas);
  const ctx = canvas.getContext('2d');
  let scene = null;
  let k = 1, ox = 0, oy = 0;           // CSS px per mm, offset in CSS px
  let W = 1, H = 1, dpr = 1;
  let fitted = true;                   // keep fitting on resize until the user zooms or pans
  let raf = 0;
  let guides = true;
  try { guides = localStorage.getItem(LS_GUIDES) !== '0'; } catch { /* private mode */ }

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const colors = () => ({
    text: css('--text'), muted: css('--muted'), primary: css('--primary'), line: css('--line'),
    panel: css('--panel'), stage: css('--stage'), err: css('--err'), warn: css('--warn'), trim: '#e63946', select: '#2a9df4',
  });

  const toWorld = (cx, cy) => ({ x: (cx - ox) / k, y: (cy - oy) / k });
  const eventPoint = (e) => { const r = canvas.getBoundingClientRect(); return { cx: e.clientX - r.left, cy: e.clientY - r.top }; };

  function fit() {
    if (!scene) return;
    const b = scene.bounds();
    const pad = Math.min(40, W * 0.06);
    k = Math.max(0.01, Math.min((W - 2 * pad) / b.w, (H - 2 * pad) / b.h));
    ox = (W - b.w * k) / 2 - b.x * k;
    oy = (H - b.h * k) / 2 - b.y * k;
    fitted = true;
    changed();
  }

  function zoomAt(factor, cx = W / 2, cy = H / 2) {
    const nk = Math.max(0.05, Math.min(400, k * factor));
    const w = toWorld(cx, cy);
    k = nk;
    ox = cx - w.x * k;
    oy = cy - w.y * k;
    fitted = false;
    changed();
  }

  function changed() { onView?.(api); invalidate(); }

  function invalidate() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }

  function draw() {
    const c = colors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.stage || '#ddd';
    ctx.fillRect(0, 0, W, H);
    if (!scene) return;
    const tl = toWorld(0, 0), br = toWorld(W, H);
    const v = {
      k, px: 1 / k, dpr, guides, colors: c, W, H,
      visible: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y },
      /** Run fn with the context in CSS-pixel screen space (for docked widgets). */
      screen(fn) { ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); fn(ctx); ctx.restore(); },
      /** Crisp label at a world position. opts: align, baseline, color, bold, size, bg, dx, dy (CSS px). */
      text(str, wx, wy, o = {}) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const size = o.size || 11;
        ctx.font = `${o.bold ? 600 : 400} ${size}px system-ui, sans-serif`;
        ctx.textAlign = o.align || 'left';
        ctx.textBaseline = o.baseline || 'alphabetic';
        const sx = wx * k + ox + (o.dx || 0), sy = wy * k + oy + (o.dy || 0);
        if (o.bg) {
          const m = ctx.measureText(str);
          const tw = m.width, left = ctx.textAlign === 'center' ? sx - tw / 2 : ctx.textAlign === 'right' ? sx - tw : sx;
          const top = ctx.textBaseline === 'middle' ? sy - size * 0.7 : ctx.textBaseline === 'top' ? sy - 2 : sy - size;
          ctx.fillStyle = o.bg;
          ctx.globalAlpha = 0.88;
          ctx.fillRect(left - 4, top - 1, tw + 8, size * 1.4 + 2);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = o.color || c.muted;
        ctx.fillText(str, sx, sy);
        ctx.restore();
      },
    };
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    scene.draw(ctx, v);
    ctx.restore();
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(50, host.clientWidth);
    H = Math.max(50, host.clientHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    if (fitted) fit(); else invalidate();
  }

  // ---------- input ----------
  let drag = null; // { pan:{x,y,ox,oy} } | { handler }
  canvas.addEventListener('pointerdown', (e) => {
    if (!scene) return;
    canvas.focus({ preventScroll: true });
    const { cx, cy } = eventPoint(e);
    const pt = toWorld(cx, cy);
    const wantsPan = e.button === 1 || e.altKey;
    const handler = !wantsPan && e.button === 0 ? scene.pointerDown?.(pt, e) : null;
    drag = handler ? { handler } : { pan: { x: e.clientX, y: e.clientY, ox, oy } };
    canvas.setPointerCapture(e.pointerId);
    if (!handler) canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const { cx, cy } = eventPoint(e);
    const pt = toWorld(cx, cy);
    if (!drag) { canvas.style.cursor = scene?.hover?.(pt) || 'default'; return; }
    if (drag.handler) { drag.handler.move?.(pt, e); invalidate(); return; }
    ox = drag.pan.ox + (e.clientX - drag.pan.x);
    oy = drag.pan.oy + (e.clientY - drag.pan.y);
    fitted = false;
    changed();
  });
  const end = (e) => {
    if (!drag) return;
    if (drag.handler) { const { cx, cy } = eventPoint(e); drag.handler.up?.(toWorld(cx, cy), e); }
    drag = null;
    canvas.style.cursor = 'default';
    invalidate();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { cx, cy } = eventPoint(e);
    zoomAt(Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 30 : 1)), cx, cy);
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { if (!scene?.dblClick?.(toWorld(eventPoint(e).cx, eventPoint(e).cy))) fit(); });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === '0' || e.key === 'f') fit();
    else if (e.key === '+' || e.key === '=') zoomAt(1.25);
    else if (e.key === '-') zoomAt(0.8);
    else if (scene?.key?.(e)) { e.preventDefault(); invalidate(); }
  });

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  themeQuery.addEventListener('change', invalidate);

  const api = {
    canvas,
    setScene(s) { scene = s; fitted = true; resize(); },
    invalidate, fit,
    zoomBy: (f) => zoomAt(f),
    /** Centre the view on a world point at a given scale (CSS px per mm). */
    focus(x, y, scale) { k = scale; ox = W / 2 - x * k; oy = H / 2 - y * k; fitted = false; changed(); },
    get dpr() { return dpr; },
    get scale() { return k; },
    get guides() { return guides; },
    setGuides(on) { guides = !!on; try { localStorage.setItem(LS_GUIDES, on ? '1' : '0'); } catch { /* ignore */ } changed(); },
    /** Zoom relative to "actual size" on a 96 dpi screen (3.78 px per mm). */
    get zoomPercent() { return Math.round((k / (96 / 25.4)) * 100); },
    destroy() { ro.disconnect(); cancelAnimationFrame(raf); themeQuery.removeEventListener('change', invalidate); canvas.remove(); },
  };
  return api;
}
