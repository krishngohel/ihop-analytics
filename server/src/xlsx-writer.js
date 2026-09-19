// A small .xlsx writer with native Excel charts. The SheetJS build we ship reads and writes
// cells but cannot write charts, so this produces the workbook parts directly: sheets with
// styled cells, plus DrawingML charts that reference the cells, which Excel and Numbers open
// as ordinary editable charts. Values are also cached inside each chart so previews that
// don't recalculate (Quick Look, mail clients) still draw it.
import { deflateRawSync } from "node:zlib";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const colLetter = (n) => { let s = ""; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const cellRef = (col, row) => `${colLetter(col)}${row + 1}`;
const absRange = (sheet, col, fromRow, toRow) => `'${sheet.replace(/'/g, "''")}'!$${colLetter(col)}$${fromRow + 1}:$${colLetter(col)}$${toRow + 1}`;

// Excel stores dates as days since 1899-12-30.
export const excelDate = (day) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse("1899-12-30T00:00:00Z")) / 864e5);

// ---- zip -----------------------------------------------------------------------------
const CRC_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[i] = c; }
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }

function zip(entries) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = []; const central = []; let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8"); const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const packed = deflateRawSync(raw); const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0, 8); dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(dosTime, 12); dir.writeUInt16LE(dosDate, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt16LE(0, 30); dir.writeUInt16LE(0, 32); dir.writeUInt16LE(0, 34); dir.writeUInt16LE(0, 36); dir.writeUInt32LE(0, 38); dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, end]);
}

// ---- styles --------------------------------------------------------------------------
const NUM_FMTS = { money: '"$"#,##0', money2: '"$"#,##0.00', pct: "0.0%", num1: "#,##0.0", int: "#,##0", rating: "0.0", date: "ddd mmm d, yyyy", week: "mmm d, yyyy" };
// font: 0 normal, 1 bold, 2 title, 3 note. fill: 2 header band. border: 1 header underline.
const STYLE_DEFS = {
  default: {}, header: { font: 1, fill: 2, border: 1, align: "center" }, headerLeft: { font: 1, fill: 2, border: 1 }, title: { font: 2 }, note: { font: 3 }, bold: { font: 1 },
  money: { fmt: "money" }, money2: { fmt: "money2" }, pct: { fmt: "pct" }, num1: { fmt: "num1" }, int: { fmt: "int" }, rating: { fmt: "rating" }, date: { fmt: "date" }, week: { fmt: "week" },
  boldMoney: { font: 1, fmt: "money" }, boldPct: { font: 1, fmt: "pct" }, boldNum1: { font: 1, fmt: "num1" }, boldInt: { font: 1, fmt: "int" }, boldRating: { font: 1, fmt: "rating" },
};
const STYLE_NAMES = Object.keys(STYLE_DEFS);
const styleId = (name) => { const i = STYLE_NAMES.indexOf(name || "default"); if (i < 0) throw new Error(`Unknown cell style ${name}`); return i; };

function stylesXml() {
  const fmtIds = Object.fromEntries(Object.keys(NUM_FMTS).map((k, i) => [k, 164 + i]));
  const numFmts = Object.entries(NUM_FMTS).map(([k, code]) => `<numFmt numFmtId="${fmtIds[k]}" formatCode="${esc(code)}"/>`).join("");
  const xfs = STYLE_NAMES.map((name) => {
    const d = STYLE_DEFS[name];
    const attrs = [`numFmtId="${d.fmt ? fmtIds[d.fmt] : 0}"`, `fontId="${d.font || 0}"`, `fillId="${d.fill || 0}"`, `borderId="${d.border || 0}"`, 'xfId="0"'];
    if (d.fmt) attrs.push('applyNumberFormat="1"'); if (d.font) attrs.push('applyFont="1"'); if (d.fill) attrs.push('applyFill="1"'); if (d.border) attrs.push('applyBorder="1"');
    const align = d.align ? `<alignment horizontal="${d.align}" vertical="center" wrapText="1"/>` : d.font === 1 && d.fill ? '<alignment vertical="center" wrapText="1"/>' : "";
    return `<xf ${attrs.join(" ")}${align ? ` applyAlignment="1">${align}</xf>` : "/>"}`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${Object.keys(NUM_FMTS).length}">${numFmts}</numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF1F3A6E"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3ECFB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9DB3D6"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${STYLE_NAMES.length}">${xfs}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

// ---- charts --------------------------------------------------------------------------
const C_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const AXIS_FMT = { money: '"$"#,##0', pct: "0.0%", num1: "#,##0", int: "#,##0", rating: "0.0", date: "mmm d", week: "mmm d", general: "General" };

const txPr = (size, color = "595959") => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

function strCache(values) {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v ?? "")}</c:v></c:pt>`).join("")}</c:strCache>`;
}
function numCache(values, formatCode) {
  const pts = values.map((v, i) => (v === null || v === undefined || Number.isNaN(v) ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join("");
  return `<c:numCache><c:formatCode>${esc(formatCode)}</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache>`;
}

/**
 * chart = { type: line|col|bar|stacked, title, categories: { ref, values, numeric?, format? },
 *           series: [{ name, ref, values, color, dashed?, pointColors? }], valueFormat, legend }
 * Colors are hex without "#". pointColors gives one color per bar (good / bad variance).
 */
function chartXml(chart) {
  const catFmt = chart.categories.format ? AXIS_FMT[chart.categories.format] : "General";
  const valFmt = AXIS_FMT[chart.valueFormat || "general"];
  const isLine = chart.type === "line";
  const horizontal = chart.type === "bar";
  const cat = chart.categories.numeric
    ? `<c:cat><c:numRef><c:f>${esc(chart.categories.ref)}</c:f>${numCache(chart.categories.values, catFmt)}</c:numRef></c:cat>`
    : `<c:cat><c:strRef><c:f>${esc(chart.categories.ref)}</c:f>${strCache(chart.categories.values)}</c:strRef></c:cat>`;
  const series = chart.series.map((s, i) => {
    const tx = `<c:tx><c:strRef><c:f>${esc(s.ref.name)}</c:f>${strCache([s.name])}</c:strRef></c:tx>`;
    const val = `<c:val><c:numRef><c:f>${esc(s.ref.values)}</c:f>${numCache(s.values, valFmt)}</c:numRef></c:val>`;
    if (isLine) {
      const ln = `<a:ln w="${s.dashed ? 19050 : 28575}" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>${s.dashed ? '<a:prstDash val="dash"/>' : ""}<a:round/></a:ln>`;
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}<c:spPr>${ln}</c:spPr><c:marker><c:symbol val="none"/></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`;
    }
    const points = (s.pointColors || []).map((color, idx) => (color ? `<c:dPt><c:idx val="${idx}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr></c:dPt>` : "")).join("");
    const labels = s.labels ? `<c:dLbls><c:numFmt formatCode="${esc(valFmt)}" sourceLinked="0"/>${txPr(900)}<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` : "";
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>${points}${labels}${cat}${val}</c:ser>`;
  }).join("");
  const plot = isLine
    ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="10"/><c:axId val="20"/></c:lineChart>`
    : `<c:barChart><c:barDir val="${horizontal ? "bar" : "col"}"/><c:grouping val="${chart.type === "stacked" ? "stacked" : "clustered"}"/><c:varyColors val="0"/>${series}<c:gapWidth val="${chart.type === "stacked" ? 60 : 120}"/>${chart.type === "stacked" ? '<c:overlap val="100"/>' : ""}<c:axId val="10"/><c:axId val="20"/></c:barChart>`;
  // Ranked horizontal bars read top to bottom in sheet order; the value axis then belongs at the bottom.
  const catOrientation = horizontal ? "maxMin" : "minMax";
  const gridColor = "D9DEE7";
  const catAx = `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="${catOrientation}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/><c:numFmt formatCode="${esc(catFmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="${gridColor}"/></a:solidFill></a:ln></c:spPr>${txPr(900)}<c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx = `<c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "b" : "l"}"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="${gridColor}"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${esc(valFmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(900)}<c:crossAx val="10"/><c:crosses val="${horizontal ? "max" : "autoZero"}"/><c:crossBetween val="between"/></c:valAx>`;
  const title = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1300" b="1"><a:solidFill><a:srgbClr val="1F2937"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="1300" b="1"/><a:t>${esc(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
  const legend = chart.legend === false ? "" : `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txPr(900)}</c:legend>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace ${C_NS}><c:roundedCorners val="0"/><c:chart>${title}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}${catAx}${valAx}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="${gridColor}"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
}

function drawingXml(anchors) {
  const frames = anchors.map((a, i) => `<xdr:twoCellAnchor editAs="oneCell">
<xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${a.col + a.width}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row + a.height}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${frames}</xdr:wsDr>`;
}

// ---- workbook ------------------------------------------------------------------------
class Sheet {
  constructor(name) {
    this.name = name; this.rows = []; this.widths = []; this.charts = []; this.freezeRows = 0;
  }
  /** cells: array of null | string | number | { v, s } where s is a style name. */
  addRow(cells, style) {
    this.rows.push(cells.map((c) => (c && typeof c === "object" && "v" in c ? c : { v: c, s: style })));
    return this.rows.length - 1;
  }
  blank(n = 1) { for (let i = 0; i < n; i++) this.rows.push([]); }
  set(row, col, v, s) { while (this.rows.length <= row) this.rows.push([]); this.rows[row][col] = { v, s }; }
  columns(widths) { this.widths = widths; }
  freeze(rows) { this.freezeRows = rows; }
  get rowCount() { return this.rows.length; }
  /** Place a chart whose top-left corner is at (col, row), sized in columns and rows. */
  chart(spec, anchor) { this.charts.push({ spec, anchor }); }
  /** Range references into this sheet for chart series. */
  colRange(col, fromRow, toRow) { return absRange(this.name, col, fromRow, toRow); }
  cellRef(col, row) { return `'${this.name.replace(/'/g, "''")}'!$${colLetter(col)}$${row + 1}`; }

  xml(drawingRel) {
    const cols = this.widths.length ? `<cols>${this.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const rows = this.rows.map((cells, r) => {
      const xs = cells.map((c, col) => {
        if (!c || c.v === null || c.v === undefined || c.v === "") return "";
        const s = styleId(c.s);
        if (typeof c.v === "number") return Number.isFinite(c.v) ? `<c r="${cellRef(col, r)}" s="${s}"><v>${c.v}</v></c>` : "";
        return `<c r="${cellRef(col, r)}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
      }).join("");
      return xs ? `<row r="${r + 1}">${xs}</row>` : "";
    }).join("");
    const pane = this.freezeRows ? `<pane ySplit="${this.freezeRows}" topLeftCell="A${this.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" showGridLines="${this.charts.length ? "0" : "1"}">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${drawingRel ? `<drawing r:id="${drawingRel}"/>` : ""}</worksheet>`;
  }
}

export class Workbook {
  constructor() { this.sheets = []; }
  sheet(name) { const s = new Sheet(name); this.sheets.push(s); return s; }

  toBuffer() {
    const files = [];
    const types = [];
    let chartNo = 0; let drawingNo = 0;
    this.sheets.forEach((sheet, i) => {
      const n = i + 1;
      let drawingRel = null;
      if (sheet.charts.length) {
        drawingNo += 1;
        const chartRels = [];
        sheet.charts.forEach((c, k) => {
          chartNo += 1;
          files.push({ name: `xl/charts/chart${chartNo}.xml`, data: chartXml(c.spec) });
          types.push(`<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
          chartRels.push(`<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNo}.xml"/>`);
        });
        files.push({ name: `xl/drawings/drawing${drawingNo}.xml`, data: drawingXml(sheet.charts.map((c) => c.anchor)) });
        files.push({ name: `xl/drawings/_rels/drawing${drawingNo}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${chartRels.join("")}</Relationships>` });
        files.push({ name: `xl/worksheets/_rels/sheet${n}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNo}.xml"/></Relationships>` });
        types.push(`<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
        drawingRel = "rId1";
      }
      files.push({ name: `xl/worksheets/sheet${n}.xml`, data: sheet.xml(drawingRel) });
      types.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    });
    const sheetsXml = this.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
    const wbRels = this.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
      + `<Relationship Id="rId${this.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    files.push({ name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000"/></bookViews><sheets>${sheetsXml}</sheets></workbook>` });
    files.push({ name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels}</Relationships>` });
    files.push({ name: "xl/styles.xml", data: stylesXml() });
    files.push({ name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
    files.unshift({ name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${types.join("")}</Types>` });
    return zip(files);
  }
}
