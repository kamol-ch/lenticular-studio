// Inline SVG illustrations for the step guides. Themed through CSS classes
// (see .art in app.css), so they follow light / dark mode.
//   bg   panel fill        st  ink stroke        ink  ink fill
//   pa   paper (white)     pr  primary fill      ps   primary stroke
//   ac   accent fill       mu  muted fill        ms   muted stroke
//   ln   lens (tinted)     t   label text        tm   muted label text

const svg = (body, w = 160, h = 100) =>
  `<svg class="art" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const COLORS = ['#d7263d', '#f46036', '#f2c14e', '#2e9e44', '#1b998b', '#2e86de', '#5f4bb6', '#c04abc'];

/** Lens profile: a row of bumps from x0 over width w, flat base at y. */
function lensRow(x0, y, w, n, hgt = 8) {
  const lw = w / n;
  let d = `M${x0} ${y}`;
  for (let i = 0; i < n; i++) d += ` q ${lw / 2} ${-hgt * 2} ${lw} 0`;
  return `<path class="ln" d="${d} Z"/>`;
}

/** Interlaced strips under a lens row. */
function strips(x0, y, w, n, k, hgt = 8) {
  let s = '';
  const sw = w / (n * k);
  for (let i = 0; i < n * k; i++) s += `<rect x="${x0 + i * sw}" y="${y}" width="${sw + 0.2}" height="${hgt}" fill="${COLORS[i % k]}"/>`;
  return s;
}

const eye = (x, y, flip = false) => `<g transform="translate(${x} ${y})${flip ? ' scale(-1 1)' : ''}"><path class="st" d="M-9 0 Q0 -7 9 0 Q0 7 -9 0Z"/><circle class="ink" cx="1" cy="0" r="2.6"/></g>`;

export const ART = {
  // ---------- Step 1 ----------
  printer: () => svg(`
    <rect class="pa" x="52" y="10" width="56" height="34" rx="2"/>
    <path class="ms" d="M60 20h40M60 27h40M60 34h28"/>
    <rect class="bg" x="30" y="40" width="100" height="36" rx="6"/>
    <rect class="pr" x="30" y="40" width="100" height="36" rx="6" opacity=".18"/>
    <rect class="pa" x="46" y="66" width="68" height="26" rx="2"/>
    <circle class="ac" cx="118" cy="51" r="4"/>
    <text class="t" x="80" y="84" text-anchor="middle">720 ppi</text>`),

  lens: () => svg(`
    ${lensRow(18, 62, 124, 8, 9)}
    <rect class="bg" x="18" y="62" width="124" height="8"/>
    <path class="ps" d="M33.5 40v-8M49 40v-8M33.5 36h15.5"/>
    <text class="t" x="80" y="26" text-anchor="middle">1 lens = 1/75 inch</text>`),

  pitchTest: () => {
    let bands = '';
    for (let b = 0; b < 5; b++) {
      const y = 12 + b * 15;
      const good = b === 2;
      bands += `<rect x="40" y="${y}" width="84" height="12" fill="${good ? '#8a8a8a' : '#bbb'}"/>`;
      if (!good) for (let i = 0; i < 4; i++) bands += `<rect x="${44 + i * 21 + b * 3}" y="${y}" width="9" height="12" fill="#444"/>`;
      bands += `<text class="tm" x="36" y="${y + 9}" text-anchor="end">${(74.8 + b * 0.05).toFixed(2)}</text>`;
    }
    return svg(`<rect class="pa" x="4" y="6" width="126" height="88" rx="2"/>${bands}
      <circle class="pr" cx="140" cy="48" r="10"/><path d="M135 48l4 4 7-8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
  },

  pitchLay: () => svg(`
    <rect class="pa" x="20" y="30" width="100" height="62" rx="2" transform="skewX(-20) translate(30 0)"/>
    ${Array.from({ length: 16 }, (_, i) => `<path d="M${42 + i * 6} 36 l-${18} 50" stroke="#555" stroke-width="2"/>`).join('')}
    <path class="ln" d="M40 22 h100 l-22 54 h-100z" opacity=".75"/>
    ${Array.from({ length: 9 }, (_, i) => `<path class="ps" d="M${50 + i * 10} 22 l-22 54" opacity=".5"/>`).join('')}
    <text class="tm" x="80" y="12" text-anchor="middle">ridges ∥ lines</text>`),

  phoneTape: () => svg(`
    <rect class="bg" x="52" y="8" width="56" height="88" rx="8"/>
    ${Array.from({ length: 8 }, (_, i) => `<rect x="58" y="${16 + i * 9}" width="44" height="9" fill="${COLORS[i]}"/>`).join('')}
    <path class="ln" d="M58 16 h44 v72 h-44z" opacity=".5"/>
    <rect x="50" y="12" width="60" height="8" fill="#e9c46a" opacity=".85"/>
    <rect x="50" y="84" width="60" height="8" fill="#e9c46a" opacity=".85"/>
    <text class="tm" x="132" y="50" text-anchor="middle">ridges</text><text class="tm" x="132" y="62" text-anchor="middle">⟷</text>`),

  /** Side view of the phone tilted by `deg`, showing colour index `c`. */
  phoneTilt: (deg = 32, c = 0) => svg(`
    ${eye(16, 34)}
    <path class="ms" d="M26 34 L94 54" stroke-dasharray="3 3"/>
    <path class="st" d="M76 82 h50" opacity=".4"/>
    <g transform="rotate(${-Number(deg)} 100 82)">
      <rect class="bg" x="94" y="22" width="12" height="60" rx="3"/>
      <rect x="95.5" y="26" width="3" height="52" fill="${COLORS[c]}"/>
    </g>
    <circle class="ink" cx="100" cy="82" r="2"/>
    <rect class="pa" x="118" y="10" width="36" height="20" rx="3"/>
    <text class="t" x="136" y="24" text-anchor="middle">${deg}°</text>`),

  flip: () => svg(`
    <rect class="pa" x="20" y="18" width="46" height="64" rx="3"/>
    <text x="43" y="62" text-anchor="middle" font-size="36" font-weight="800" class="ink">A</text>
    <path class="ps" d="M74 50h14m-5-5 5 5-5 5"/>
    <rect x="96" y="18" width="46" height="64" rx="3" fill="#222"/>
    <text x="119" y="62" text-anchor="middle" font-size="36" font-weight="800" fill="#fff">B</text>`),

  /** Spread test: bands whose white strips get wider; the even one is picked. */
  spread: () => {
    let bands = '';
    const whites = [1.2, 2.4, 3.6, 4.6];
    whites.forEach((ww, b) => {
      const y = 12 + b * 20;
      bands += `<rect x="40" y="${y}" width="84" height="15" fill="#222"/>`;
      for (let i = 0; i < 12; i++) {
        const uneven = b < 2 && i % 3 === 2 ? 0.35 : 1; // under-compensated: some white strips close up
        bands += `<rect x="${41 + i * 7}" y="${y}" width="${ww * uneven}" height="15" fill="#fff"/>`;
      }
      bands += `<text class="tm" x="36" y="${y + 11}" text-anchor="end">${(b * 0.02).toFixed(2)}</text>`;
    });
    return svg(`<rect class="pa" x="4" y="6" width="126" height="88" rx="2"/>${bands}
      <circle class="pr" cx="142" cy="59" r="10"/><path d="M137 59l4 4 7-8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
  },

  // ---------- Step 2 ----------
  effect3d: () => svg(`
    ${eye(50, 14)}${eye(110, 14)}
    <path class="ms" d="M50 22 L74 66M110 22 L86 66" stroke-dasharray="3 3"/>
    ${strips(40, 74, 80, 5, 2, 10)}
    ${lensRow(40, 74, 80, 5, 7)}`),

  effectAnim: () => svg(`
    <g opacity=".45" transform="rotate(-14 80 50)"><rect class="pa" x="56" y="20" width="48" height="60" rx="3"/><circle cx="80" cy="44" r="10" fill="${COLORS[5]}"/></g>
    <rect class="pa" x="56" y="20" width="48" height="60" rx="3"/><circle cx="80" cy="58" r="10" fill="${COLORS[0]}"/>
    <path class="ps" d="M122 30 q12 20 0 40m-4-6 4 6 5-5"/>`),

  bleed: () => svg(`
    <rect class="pr" x="40" y="8" width="80" height="84" rx="2" opacity=".22"/>
    <rect class="pa" x="48" y="16" width="64" height="68"/>
    <rect x="48" y="16" width="64" height="68" fill="none" stroke="#e63946" stroke-width="1.5" stroke-dasharray="4 3"/>
    <text class="t" x="80" y="54" text-anchor="middle">card</text>
    <text class="tm" x="126" y="14">bleed</text>
    <text class="tm" x="126" y="88" fill="#e63946">trim</text>`),

  framesEyes: () => svg(`
    ${strips(30, 70, 100, 1, 8, 12)}
    ${lensRow(30, 70, 100, 1, 26)}
    ${eye(44, 12)}${eye(116, 12)}
    <path class="ms" d="M44 20 L92 70M116 20 L68 70" stroke-dasharray="3 3"/>`),

  // ---------- Step 3 ----------
  layers: () => svg(`
    <path d="M30 70 l60 -14 l40 14 l-60 14z" fill="#9cc5de"/>
    <path d="M30 52 l60 -14 l40 14 l-60 14z" fill="#e9c46a" opacity=".9"/>
    <circle cx="80" cy="30" r="12" fill="${COLORS[0]}"/>
    <text class="tm" x="8" y="74">back</text><text class="tm" x="8" y="34">front</text>`),

  arrange: () => svg(`
    <rect class="pa" x="40" y="10" width="62" height="80" rx="2"/>
    <rect x="52" y="30" width="38" height="38" fill="none" stroke="#2a9df4" stroke-width="2"/>
    <circle cx="71" cy="49" r="12" fill="${COLORS[1]}"/>
    <path class="ink" d="M108 60 l0 22 l6 -6 l5 10 l4 -2 l-5 -10 l8 0z"/>
    <text class="tm" x="132" y="40" text-anchor="middle">drag</text><text class="tm" x="132" y="52" text-anchor="middle">scroll</text>`),

  // ---------- Step 4 ----------
  motion: () => {
    let f = '';
    [0, -6, 0, 6].forEach((dy, i) => {
      const x = 8 + i * 38;
      f += `<rect class="pa" x="${x}" y="22" width="32" height="48" rx="2"/><circle cx="${x + 16}" cy="${46 + dy}" r="7" fill="${COLORS[0]}"/><text class="tm" x="${x + 16}" y="84" text-anchor="middle">${i + 1}</text>`;
    });
    return svg(f);
  },

  video: () => svg(`
    <rect class="ink" x="8" y="28" width="56" height="40" rx="3"/>
    ${[0, 1, 2, 3].map((i) => `<rect x="${12 + i * 13}" y="31" width="5" height="4" fill="#fff" opacity=".7"/><rect x="${12 + i * 13}" y="61" width="5" height="4" fill="#fff" opacity=".7"/>`).join('')}
    <path d="M30 40v16l12-8z" fill="#fff"/>
    <path class="ps" d="M70 48h16m-5-5 5 5-5 5"/>
    ${[0, 1, 2].map((i) => `<rect class="pa" x="${94 + i * 20}" y="${30 + i * 2}" width="18" height="36" rx="1"/>`).join('')}`),

  mask: () => svg(`
    <rect class="pa" x="30" y="10" width="64" height="80" rx="2"/>
    <circle cx="62" cy="40" r="15" fill="#ff2d55" opacity=".45"/>
    <circle cx="62" cy="40" r="8" fill="${COLORS[2]}"/><path d="M62 48 v30" stroke="#2e9e44" stroke-width="3"/>
    <path class="ink" d="M104 70 l22 -32 l6 4 l-22 32z"/><path d="M104 70 l-4 10 l10 -6z" fill="#ff2d55"/>`),

  // ---------- Step 5 ----------
  depthLayers: () => svg(`
    ${eye(80, 92)}
    <path class="st" d="M20 18h120" opacity=".5"/><text class="tm" x="22" y="14">far −1</text>
    <path class="ps" d="M20 48h120" stroke-dasharray="5 3"/><text class="t" x="22" y="44">key plane 0</text>
    <path class="st" d="M66 74h60"/><text class="tm" x="22" y="78">near +1</text>`),

  depthMap: () => svg(`
    <defs><radialGradient id="dg"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#666"/></radialGradient></defs>
    <rect x="30" y="8" width="64" height="84" rx="2" fill="#222"/>
    <ellipse cx="62" cy="54" rx="22" ry="26" fill="url(#dg)"/>
    <text class="t" x="104" y="44">white</text><text class="tm" x="104" y="56">= near</text>
    <text class="t" x="104" y="76">black</text><text class="tm" x="104" y="88">= far</text>`),

  anaglyph: () => svg(`
    <path class="st" d="M20 46 h120"/>
    <rect x="28" y="36" width="44" height="30" rx="10" fill="#e63946" opacity=".75"/>
    <rect x="88" y="36" width="44" height="30" rx="10" fill="#17becf" opacity=".75"/>
    <path class="st" d="M72 48 q8 -8 16 0"/>`),

  // ---------- Step 6 ----------
  interlace: () => {
    const fr = [0, 3, 5].map((c, i) => `<rect x="${8 + i * 18}" y="${18 + i * 5}" width="28" height="40" rx="2" fill="${COLORS[c]}" opacity=".9"/>`).join('');
    let s = '';
    for (let i = 0; i < 18; i++) s += `<rect x="${96 + i * 3.4}" y="48" width="3.5" height="16" fill="${COLORS[[0, 3, 5][i % 3]]}"/>`;
    return svg(`${fr}<path class="ps" d="M68 52h16m-5-5 5 5-5 5"/>${s}${lensRow(96, 48, 61.2, 6, 6)}`);
  },

  marks: () => svg(`
    <rect class="pa" x="44" y="22" width="72" height="60"/>
    <rect class="pr" x="52" y="30" width="56" height="44" opacity=".25"/>
    <path class="st" d="M52 12v12M108 12v12M34 30h12M34 74h12M52 80v12M108 80v12M114 30h12M114 74h12" stroke-width="1.5"/>
    ${Array.from({ length: 14 }, (_, i) => `<rect x="${52 + i * 4}" y="8" width="1.6" height="8" class="ink"/>`).join('')}
    <text class="tm" x="132" y="14">strip</text>`),

  tilt: () => svg(`
    ${strips(40, 66, 80, 1, 8, 12)}
    <rect x="${40 + 4 * 10}" y="66" width="10" height="12" fill="none" stroke="var(--text)" stroke-width="2"/>
    ${lensRow(40, 66, 80, 1, 24)}
    ${eye(110, 12)}
    <path class="ms" d="M110 20 L85 66" stroke-dasharray="3 3"/>`),

  // ---------- Step 7 ----------
  print: () => svg(`
    <rect class="pa" x="44" y="14" width="56" height="72" rx="2"/>
    ${strips(52, 24, 40, 1, 8, 54)}
    <text class="tm" x="128" y="44" text-anchor="middle">100%</text><text class="tm" x="128" y="58" text-anchor="middle">let dry</text>`),

  align: () => svg(`
    <rect class="pa" x="30" y="20" width="100" height="62"/>
    ${Array.from({ length: 24 }, (_, i) => `<rect x="${34 + i * 4}" y="24" width="1.6" height="8" class="ink"/>`).join('')}
    <rect class="ln" x="34" y="20" width="92" height="66" rx="2" opacity=".6"/>
    ${Array.from({ length: 12 }, (_, i) => `<path class="ps" d="M${38 + i * 8} 20v66" opacity=".45"/>`).join('')}`),

  tape: () => svg(`
    <rect class="pa" x="30" y="26" width="100" height="56"/>
    <rect class="ln" x="30" y="22" width="100" height="56" rx="2" opacity=".6"/>
    <rect x="22" y="18" width="20" height="64" fill="#e9c46a" opacity=".85"/>`),

  roll: () => svg(`
    <rect class="pa" x="20" y="60" width="120" height="10"/>
    <path class="ln" d="M20 60 L110 60 Q130 40 140 30 L140 34 Q130 46 112 64 L20 64z" opacity=".7"/>
    <circle class="ink" cx="96" cy="50" r="9"/><path class="st" d="M96 50 l16 -26"/>`),

  trim: () => svg(`
    <rect class="pa" x="30" y="20" width="80" height="64"/>
    <rect x="30" y="44" width="80" height="6" class="mu"/>
    <path class="ink" d="M112 48 l28 -16 l4 4 l-28 16z"/>
    <path class="st" d="M24 47 h96" stroke-dasharray="4 3"/>`),
};
