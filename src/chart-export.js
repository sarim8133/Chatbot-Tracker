// Rasterizing a chart's <svg> to a PNG — used by the per-chart download button
// (charts.jsx) and the print-snapshot swap (mawavia-dashboard.jsx's
// ExportTabButton). Split into its own module rather than living in charts.jsx:
// this file has no Recharts import (it's plain DOM/canvas), so mawavia-
// dashboard.jsx can import it statically without pulling the charting bundle
// into the main chunk — and mixing these plain-function exports into charts.jsx
// (which otherwise only exports components) broke Vite's Fast Refresh for that
// file (react-refresh/only-export-components).
//
// Zero dependency, and none needed: Recharts writes every colour as an SVG
// attribute (see charts.jsx's top-of-file note), so a chart's <svg> is already
// self-describing. Clone it, rasterize through a canvas at 2x.
//
// Two deliberate choices:
//   • The canvas is painted white first. A dark-theme chart is transparent
//     otherwise, and pasted into a document it reads as an empty box.
//   • Fonts fall back. An <img> rendering an SVG is an isolated document — it
//     cannot reach the web fonts the page loaded — so the PNG uses the system
//     sans/mono. Glyph positions are absolute, so nothing shifts; only the
//     typeface differs, which is not worth base64-ing two woff2 files for.
const PNG_SCALE = 2;

async function rasterizeSVG(svg, scale = PNG_SCALE) {
  const box = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width));
  const h = Math.max(1, Math.round(box.height));

  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // The canvas is always painted white, but the SVG's colours came from
  // useThemeColors() at render time — in dark mode that's near-white labels
  // (c.text) and pale grey-blue ticks (c.muted), tuned for a dark panel. Left
  // alone they're unreadable on a white background — every <text> is forced
  // to one fixed, readable dark grey and every grid line to one fixed light
  // grey, regardless of the viewer's current theme. Deliberately not scoped
  // to a Recharts class name (those have changed across major versions);
  // every <text> node under this SVG is chart-drawn, nothing else lives here.
  clone.querySelectorAll('text').forEach(t => { t.setAttribute('fill', '#3F3F46'); });
  clone.querySelectorAll('.recharts-cartesian-grid line').forEach(l => { l.setAttribute('stroke', '#E4E4E7'); });

  const svgUrl = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' })
  );
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not render the chart.'));
      i.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chart';

// `host` is the element wrapping the chart; the first <svg> inside it is what
// gets saved (see charts.jsx's DownloadBtn).
export async function downloadChartPNG(host, title) {
  const svg = host?.querySelector('svg');
  if (!svg) return;
  const canvas = await rasterizeSVG(svg);
  const png = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!png) throw new Error('Could not encode the image.');

  const href = URL.createObjectURL(png);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${slug(title)}-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

// ── Swap every chart's live SVG for a pre-rendered snapshot before printing ──
// Recharts' ResponsiveContainer measures its box with a ResizeObserver
// (node_modules/recharts/.../ResponsiveContainer.js). @media print switches
// the page to the print viewport's width, which is a genuine box-size change —
// but there is no guarantee the observer's callback, and the React re-render
// it triggers, complete before the browser captures the printed page. That
// race is a well-known cause of charts printing blank. Rather than hope it
// resolves in time, every chart the user is about to print is rasterized from
// its CURRENT, already-correctly-rendered on-screen SVG — no re-measurement
// involved — and swapped in as a plain <img> just before window.print() is
// called (see mawavia-dashboard.jsx's ExportTabButton.handlePdf), then swapped
// back on 'afterprint'. Reuses the exact rasterizeSVG() the PNG download
// button uses, so print gets the same "always readable" text-colour fix free.
//
// Charts are found via `[data-chart-host]`, set on the ref'd wrapper div of
// every chart in charts.jsx — not `role="img"`, which several of those divs
// also carry for accessibility but is a different concern and isn't present
// on every host (e.g. the Categories donut's wrapper).
export async function snapshotChartsForPrint() {
  const hosts = Array.from(document.querySelectorAll('[data-chart-host]'));
  const restores = [];
  await Promise.all(hosts.map(async (host) => {
    const svg = host.querySelector('svg');
    if (!svg) return; // e.g. an empty-state host with no chart mounted
    try {
      const canvas = await rasterizeSVG(svg);
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;display:block;';
      // The Categories donut's <svg> is nested two levels under `host`, with a
      // center-total overlay and a legend list as siblings elsewhere in that
      // tree. Appending the image to `host` would tack it on AFTER all of
      // that — replaceWith() drops it into the exact slot the SVG occupied,
      // which is correct for every host regardless of how deep the SVG sits.
      svg.replaceWith(img);
      restores.push(() => img.replaceWith(svg));
    } catch {
      // Leave this one chart live (possibly blank) rather than fail the export.
    }
  }));
  return () => restores.forEach(fn => fn());
}
