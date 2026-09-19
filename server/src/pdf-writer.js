// A small PDF writer: text in the built-in Helvetica faces, vector shapes, and the handful
// of chart types the weekly report needs. Nothing is rasterized and nothing outside Node is
// needed, so the report generates in a moment on any Mac the app runs on.

// Helvetica and Helvetica-Bold advance widths (AFM, per 1000 em) for WinAnsi codes 32-255.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];

// Characters outside ASCII that the report uses, mapped to their WinAnsi code.
const WINANSI = { "–": 150, "—": 151, "‘": 145, "’": 146, "“": 147, "”": 148, "•": 149, "·": 183, "°": 176, "…": 133, " ": 160, "↑": 43, "↓": 45, "→": 45 };
function encode(text) {
  const bytes = [];
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code < 128) bytes.push(code);
    else if (WINANSI[ch] !== undefined) bytes.push(WINANSI[ch]);
    else if (code >= 160 && code <= 255) bytes.push(code);
    else bytes.push(63);
  }
  return bytes;
}

export function textWidth(text, size, bold = false) {
  const table = bold ? W_BOLD : W_REG;
  return encode(text).reduce((w, b) => w + (b >= 32 ? table[b - 32] || 556 : 0), 0) * size / 1000;
}

const escapePdf = (bytes) => { let s = ""; for (const b of bytes) { if (b === 40 || b === 41 || b === 92) s += "\\" + String.fromCharCode(b); else if (b < 32 || b > 126) s += "\\" + b.toString(8).padStart(3, "0"); else s += String.fromCharCode(b); } return s; };
const num = (n) => (Math.round(n * 100) / 100).toString();
const rgb = (hex) => { const h = hex.replace("#", ""); return [0, 2, 4].map((i) => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(" "); };

export class PdfPage {
  constructor(doc, width, height) { this.doc = doc; this.width = width; this.height = height; this.ops = []; }
  // Coordinates are top-down (y grows downward, like the screen); flipped when written.
  y(v) { return this.height - v; }
  text(str, x, y, { size = 10, bold = false, color = "1F2937", align = "left", maxWidth } = {}) {
    let s = String(str ?? "");
    if (maxWidth) while (s.length > 1 && textWidth(s, size, bold) > maxWidth) s = s.slice(0, -2) + "…";
    const w = textWidth(s, size, bold);
    const tx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${rgb(color)} rg ${num(tx)} ${num(this.y(y))} Td (${escapePdf(encode(s))}) Tj ET`);
    return w;
  }
  /** Word-wrapped paragraph; returns the y just below the last line. */
  paragraph(str, x, y, width, { size = 10, bold = false, color = "1F2937", leading } = {}) {
    const lh = leading || size * 1.4;
    const words = String(str ?? "").split(/\s+/).filter(Boolean);
    let line = ""; let yy = y;
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (textWidth(trial, size, bold) > width && line) { this.text(line, x, yy, { size, bold, color }); yy += lh; line = w; } else line = trial;
    }
    if (line) { this.text(line, x, yy, { size, bold, color }); yy += lh; }
    return yy;
  }
  rect(x, y, w, h, { fill, stroke, lineWidth = 0.5, radius = 0 } = {}) {
    const ops = [];
    if (fill) ops.push(`${rgb(fill)} rg`); if (stroke) ops.push(`${rgb(stroke)} RG ${num(lineWidth)} w`);
    const y0 = this.y(y + h);
    if (radius > 0) {
      const r = Math.min(radius, w / 2, h / 2); const k = 0.5523 * r; const x1 = x + w; const y1 = y0 + h;
      ops.push(`${num(x + r)} ${num(y0)} m ${num(x1 - r)} ${num(y0)} l ${num(x1 - r + k)} ${num(y0)} ${num(x1)} ${num(y0 + r - k)} ${num(x1)} ${num(y0 + r)} c`);
      ops.push(`${num(x1)} ${num(y1 - r)} l ${num(x1)} ${num(y1 - r + k)} ${num(x1 - r + k)} ${num(y1)} ${num(x1 - r)} ${num(y1)} c`);
      ops.push(`${num(x + r)} ${num(y1)} l ${num(x + r - k)} ${num(y1)} ${num(x)} ${num(y1 - r + k)} ${num(x)} ${num(y1 - r)} c`);
      ops.push(`${num(x)} ${num(y0 + r)} l ${num(x)} ${num(y0 + r - k)} ${num(x + r - k)} ${num(y0)} ${num(x + r)} ${num(y0)} c h`);
    } else ops.push(`${num(x)} ${num(y0)} ${num(w)} ${num(h)} re`);
    ops.push(fill && stroke ? "B" : fill ? "f" : "S");
    this.ops.push(ops.join(" "));
  }
  line(x1, y1, x2, y2, { color = "D9DEE7", width = 0.5, dash } = {}) {
    this.ops.push(`${rgb(color)} RG ${num(width)} w ${dash ? `[${dash.join(" ")}] 0 d` : "[] 0 d"} ${num(x1)} ${num(this.y(y1))} m ${num(x2)} ${num(this.y(y2))} l S`);
  }
  polyline(points, { color = "2A78D6", width = 1.5, dash } = {}) {
    const pts = points.filter((p) => p);
    if (pts.length < 2) return;
    this.ops.push(`${rgb(color)} RG ${num(width)} w 1 J 1 j ${dash ? `[${dash.join(" ")}] 0 d` : "[] 0 d"} ` + pts.map((p, i) => `${num(p[0])} ${num(this.y(p[1]))} ${i ? "l" : "m"}`).join(" ") + " S");
  }
  circle(x, y, r, fill) {
    const k = 0.5523 * r; const cy = this.y(y);
    this.ops.push(`${rgb(fill)} rg ${num(x + r)} ${num(cy)} m ${num(x + r)} ${num(cy + k)} ${num(x + k)} ${num(cy + r)} ${num(x)} ${num(cy + r)} c ${num(x - k)} ${num(cy + r)} ${num(x - r)} ${num(cy + k)} ${num(x - r)} ${num(cy)} c ${num(x - r)} ${num(cy - k)} ${num(x - k)} ${num(cy - r)} ${num(x)} ${num(cy - r)} c ${num(x + k)} ${num(cy - r)} ${num(x + r)} ${num(cy - k)} ${num(x + r)} ${num(cy)} c f`);
  }
  link(x, y, w, h, url) { this.doc.links.push({ page: this, rect: [x, this.y(y + h), x + w, this.y(y)], url }); }
}

export class PdfDocument {
  constructor({ width = 612, height = 792, title = "Report", author = "IHOP Operations" } = {}) {
    this.width = width; this.height = height; this.title = title; this.author = author; this.pages = []; this.links = [];
  }
  addPage() { const p = new PdfPage(this, this.width, this.height); this.pages.push(p); return p; }

  toBuffer() {
    const objects = []; // 1-based object bodies; ids are reserved first so parents can be referenced before they are written
    const reserve = () => { objects.push(null); return objects.length; };
    const set = (id, body) => { objects[id - 1] = body; };
    const fontReg = reserve(); set(fontReg, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBold = reserve(); set(fontBold, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pagesId = reserve();
    const pageIds = [];
    for (const page of this.pages) {
      const content = page.ops.join("\n");
      const contentId = reserve(); set(contentId, `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
      const annots = this.links.filter((l) => l.page === page).map((l) => {
        const id = reserve();
        set(id, `<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(num).join(" ")}] /Border [0 0 0] /A << /S /URI /URI (${escapePdf(encode(l.url))}) >> >>`);
        return `${id} 0 R`;
      });
      const pageId = reserve();
      set(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R${annots.length ? ` /Annots [${annots.join(" ")}]` : ""} >>`);
      pageIds.push(pageId);
    }
    set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    const catalogId = reserve(); set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const infoId = reserve(); set(infoId, `<< /Title (${escapePdf(encode(this.title))}) /Author (${escapePdf(encode(this.author))}) /Producer (IHOP Operations) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`);

    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [];
    objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }
}

// ---- charts -------------------------------------------------------------------------------
const niceStep = (span, target = 4) => { const rough = span / target; const mag = 10 ** Math.floor(Math.log10(rough || 1)); return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) || mag; };
function scale(values, { zero = true, pad = 0.08 } = {}) {
  const nums = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  let min = nums.length ? Math.min(...nums) : 0; let max = nums.length ? Math.max(...nums) : 1;
  if (zero) { min = Math.min(0, min); max = Math.max(0, max); }
  if (min === max) { max = min + 1; }
  const span = max - min; min -= span * pad * (min < 0 ? 1 : 0); max += span * pad;
  const step = niceStep(max - min);
  min = Math.floor(min / step) * step; max = Math.ceil(max / step) * step;
  const ticks = []; for (let t = min; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { min, max, ticks };
}

/**
 * Line chart. series: [{ values, color, dashed, label }], categories: labels per x position.
 * `format` renders axis ticks. Leaves room for a legend below the plot.
 */
export function lineChart(page, { x, y, w, h, categories, series, format, title, zero = true, labelEvery }) {
  const padL = 46; const padB = 26; const padT = title ? 22 : 8; const padR = 8;
  const plotW = w - padL - padR; const plotH = h - padT - padB - 14;
  if (title) page.text(title, x, y + 12, { size: 10.5, bold: true, color: "111827" });
  const sc = scale(series.flatMap((s) => s.values), { zero });
  const yOf = (v) => y + padT + plotH - ((v - sc.min) / (sc.max - sc.min)) * plotH;
  const n = categories.length; const xOf = (i) => x + padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  for (const t of sc.ticks) { page.line(x + padL, yOf(t), x + padL + plotW, yOf(t), { color: t === 0 ? "9CA3AF" : "E5E7EB" }); page.text(format(t), x + padL - 6, yOf(t) + 3, { size: 7.5, color: "6B7280", align: "right" }); }
  const every = labelEvery || Math.max(1, Math.ceil(n / Math.floor(plotW / 44)));
  categories.forEach((c, i) => { if (i % every === 0 || i === n - 1) page.text(c, xOf(i), y + padT + plotH + 12, { size: 7.5, color: "6B7280", align: "center" }); });
  for (const s of series) {
    let run = [];
    const flush = () => { if (run.length > 1) page.polyline(run, { color: s.color, width: s.width || 1.6, dash: s.dashed ? [3, 2] : undefined }); else if (run.length === 1) page.circle(run[0][0], run[0][1], 2, s.color); run = []; };
    s.values.forEach((v, i) => { if (v === null || v === undefined || !Number.isFinite(v)) flush(); else run.push([xOf(i), yOf(v)]); });
    flush();
  }
  legend(page, x + padL, y + h - 4, series);
}

/** Vertical bars, grouped when several series are given. */
export function columnChart(page, { x, y, w, h, categories, series, format, title, colors, valueLabels }) {
  const padL = 46; const padB = 26; const padT = title ? 22 : 8; const padR = 8;
  const plotW = w - padL - padR; const plotH = h - padT - padB - (series.length > 1 ? 14 : 2);
  if (title) page.text(title, x, y + 12, { size: 10.5, bold: true, color: "111827" });
  const sc = scale(series.flatMap((s) => s.values));
  const yOf = (v) => y + padT + plotH - ((v - sc.min) / (sc.max - sc.min)) * plotH;
  const n = categories.length; const slot = plotW / Math.max(1, n); const gap = slot * 0.25; const bw = (slot - gap) / series.length;
  for (const t of sc.ticks) { page.line(x + padL, yOf(t), x + padL + plotW, yOf(t), { color: t === 0 ? "9CA3AF" : "E5E7EB" }); page.text(format(t), x + padL - 6, yOf(t) + 3, { size: 7.5, color: "6B7280", align: "right" }); }
  categories.forEach((c, i) => page.text(c, x + padL + slot * i + slot / 2, y + padT + plotH + 12, { size: 7.5, color: "6B7280", align: "center", maxWidth: slot - 2 }));
  series.forEach((s, k) => s.values.forEach((v, i) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    const bx = x + padL + slot * i + gap / 2 + bw * k; const top = yOf(Math.max(v, 0)); const bottom = yOf(Math.min(v, 0));
    const color = colors ? colors(v, i) : s.color;
    page.rect(bx, top, bw - 1, Math.max(0.5, bottom - top), { fill: color });
    if (valueLabels) page.text(valueLabels(v), bx + (bw - 1) / 2, v >= 0 ? top - 3 : bottom + 8, { size: 7, color: "374151", align: "center" });
  }));
  if (series.length > 1) legend(page, x + padL, y + h - 4, series);
}

/** Horizontal ranked bars with the value printed at the end of each bar. */
export function barChart(page, { x, y, w, h, rows, format, title, good }) {
  const padT = title ? 20 : 4; const labelW = Math.min(150, w * 0.36);
  if (title) page.text(title, x, y + 12, { size: 10.5, bold: true, color: "111827" });
  const plotX = x + labelW + 6; const plotW = w - labelW - 6 - 44;
  const vals = rows.map((r) => r.value);
  const sc = scale(vals, { pad: 0.05 });
  const xOf = (v) => plotX + ((v - sc.min) / (sc.max - sc.min)) * plotW;
  const rowH = Math.min(18, (h - padT) / Math.max(1, rows.length));
  page.line(xOf(0), y + padT - 2, xOf(0), y + padT + rowH * rows.length, { color: "9CA3AF" });
  rows.forEach((r, i) => {
    const cy = y + padT + rowH * i;
    page.text(r.label, plotX - 6, cy + rowH * 0.68, { size: 8, color: "374151", align: "right", maxWidth: labelW });
    if (r.value === null || r.value === undefined) { page.text("no data", xOf(0) + 4, cy + rowH * 0.68, { size: 7.5, color: "9CA3AF" }); return; }
    const x0 = xOf(Math.min(0, r.value)); const x1 = xOf(Math.max(0, r.value));
    page.rect(x0, cy + rowH * 0.18, Math.max(0.5, x1 - x0), rowH * 0.64, { fill: good(r.value) ? "16803C" : "D03B3B", radius: 1.5 });
    page.text(format(r.value), r.value >= 0 ? x1 + 4 : xOf(0) + 4, cy + rowH * 0.68, { size: 8, bold: true, color: "111827" });
  });
}

function legend(page, x, y, series) {
  let cx = x;
  for (const s of series) {
    if (!s.label) continue;
    page.line(cx, y - 3, cx + 12, y - 3, { color: s.color, width: 2, dash: s.dashed ? [3, 2] : undefined });
    page.text(s.label, cx + 16, y, { size: 7.5, color: "4B5563" });
    cx += 16 + textWidth(s.label, 7.5) + 14;
  }
}
