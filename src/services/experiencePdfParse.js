// Reads a "Pilot experience summary" PDF into the record the Experience
// builder fills in.
//
// This file is the ONE parser. It was previously only inside the Electron
// main process, which is why the web admin could only answer "PDF import is
// only available in the PC app" - the code simply wasn't there. Both builds
// now call this: Electron reads the file from disk, the browser reads it from
// a file input, and from that point on the two are identical, so a fix to the
// parsing can never apply to only one of them.
//
// It is GEOMETRIC, not textual. The source PDF is four tables laid out in
// quadrants (Rotary/Fixed x Single/Multi) plus a simulator block, and the
// same fleet appears as "S76C+/C++", "SK76", "S76D"... across pilots, so
// nothing can be matched by name. Instead every text run keeps its x/y
// position on the page, and rows and columns are found by where things sit.
//
// The input is an array of positioned text runs:
//   { page, x, y, text, width, height }   y measured from the TOP of the page
// pdfItemsFromDocument() below builds that from any pdf.js document, in
// either environment.

const isHour = (v) => /^\d+:\d{2}$/.test(String(v || "").trim());
// Day must be 1-31 (not 0) so this can't match template placeholder dates
// like "0-Jan-00" that some PDFs carry as hidden/unrendered text. Also
// accepts free-form "D[-D] Month YYYY" entries (e.g. "1-9 July 2023") seen
// in some simulator-date cells alongside the usual "DD-Mon-YY" format.
const DAY = "([1-9]|[12]\\d|3[01])";
const DATE_PATTERN = `(${DAY}-[A-Za-z]{3}-\\d{2,4}|${DAY}(-${DAY})?\\s+[A-Za-z]+\\s+\\d{4})`;
// Matches the general "D-Mon-YY" shape regardless of day validity - used to
// reject rejected-date placeholders (e.g. "0-Jan-00") from ever being mistaken
// for a type/label just because they happen to contain letters.
const LOOSE_DATE_SHAPE = /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/;

// Some PDF generators emit a single visual number like "300:36" as several
// separate text-run fragments ("300", ":", "36") purely because of kerning
// adjustments in the content stream, even though the fragments touch with a
// near-zero gap. isHour() only matches a complete "H:MM" string, so an
// unmerged fragment is silently treated as an empty cell - and (combined with
// a wide neighbour-table search window) a value from the adjacent table could
// get pulled in instead. This merges same-line fragments back into whole
// tokens before any column/pattern matching happens.
export function mergeFragments(items, gapThreshold = 2, yTolerance = 3) {
  const byPage = {};
  for (const it of items) (byPage[it.page] = byPage[it.page] || []).push(it);

  const merged = [];
  for (const page in byPage) {
    const rows = [];
    for (const it of byPage[page]) {
      let row = rows.find((r) => Math.abs(r.y - it.y) < yTolerance);
      if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
      row.items.push(it);
    }
    for (const row of rows) {
      const sorted = row.items.slice().sort((a, b) => a.x - b.x);
      let current = null;
      for (const it of sorted) {
        if (current && it.x - (current.x + current.width) <= gapThreshold) {
          current.text += it.text;
          current.width = (it.x + it.width) - current.x;
          current.height = Math.max(current.height, it.height);
        } else {
          if (current) merged.push(current);
          current = { ...it };
        }
      }
      if (current) merged.push(current);
    }
  }
  return merged.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}

export function parseExperience(items, fileName) {
  const allText = items.map((i) => i.text).join(" ");
  const code = getCode(items, fileName);
  const name = getName(items, allText);
  const licence = getLicence(items, allText);
  const update = getUpdate(items, allText);
  const specialty = getSpecialty(items, allText);
  const sim = getSimulator(items);
  const aircraft = getAircraftTables(items, allText);
  return {
    code, name, licence, update, specialty, sim,
    rotarySingle: aircraft.rotarySingle,
    fixedSingle: aircraft.fixedSingle,
    rotaryMulti: aircraft.rotaryMulti,
    fixedMulti: aircraft.fixedMulti,
    totalsFromPdf: aircraft.totalsFromPdf,
    rawText: allText
  };
}

function getCode(items, fileName) {
  const label = items.find((i) => /CODE/i.test(i.text));
  const value = rightText(items, label, { maxDx: 130, maxDy: 12, reject: /INPUT|<|=|:/i });
  return value || String(fileName || "").replace(/\.[^.]+$/, "").toUpperCase();
}

function getName(items, allText) {
  const label = items.find((i) => /^Name/i.test(i.text));
  const value = rightText(items, label, { maxDx: 360, maxDy: 12, reject: /Licence|License|No\.?|:/i });
  if (value) return value;
  const m = allText.match(/Pilot experience summary\s+([A-Za-z\s]+?)\s+TH\.?\s*FCL/i);
  return m ? m[1].trim() : "";
}

function getLicence(items, allText) {
  const label = items.find((i) => /Licence|License/i.test(i.text));
  const value = rightText(items, label, { maxDx: 340, maxDy: 12, accept: /TH\.?\s*FCL/i });
  const source = value || allText;
  const m = source.match(/TH\.?\s*FCL\.?\s*\d+/i);
  return m ? m[0].replace(/\s+/g, "").replace(/TH\.?FCL\.?/i, "TH.FCL.") : "";
}

function getUpdate(items, allText) {
  const label = items.find((i) => /^Update/i.test(i.text));
  const value = rightText(items, label, { maxDx: 180, maxDy: 12, accept: new RegExp(DATE_PATTERN) });
  if (value) return value;
  const dates = allText.match(new RegExp(DATE_PATTERN, "g")) || [];
  return dates.length ? dates[dates.length - 1] : "";
}

function getSpecialty(items, allText) {
  return [
    ["IFR(IMC)", hourRightOf(items, /IFR/i) || getHourByIndex(allText, 0)],
    ["Night", hourRightOf(items, /^Night$/i) || getHourByIndex(allText, 1)],
    ["Offshore", hourRightOf(items, /Offshore/i) || getHourByIndex(allText, 2)],
    ["TRI", hourRightOf(items, /^TRI$/i) || getHourByIndex(allText, 3) || "0:00"],
    ["TRE", hourRightOf(items, /^TRE$/i) || getHourByIndex(allText, 4) || "0:00"]
  ];
}

function getSimulator(items) {
  const header = items.find((i) => /Sim\.?Type/i.test(i.text));
  if (!header) return [];
  const rows = groupRows(items.filter((i) =>
    i.page === header.page &&
    i.y > header.y + 8 &&
    i.y < header.y + 105 &&
    i.x > header.x - 25 &&
    i.x < header.x + 330 &&
    !/Add|Simulator|Date|Last|Attended|PHOTO|LOGO/i.test(i.text)
  ), 8);
  const dateRe = new RegExp(DATE_PATTERN);
  const out = [];
  for (const row of rows) {
    const dateItem = row.find((i) => dateRe.test(i.text));
    // The type cell has no fixed spelling across pilots/fleets (AW139, S76D,
    // SK76, ...), so instead of matching a whitelist, take whichever other
    // cell in the row contains a letter (guards against stray placeholder
    // "0" cells some PDFs carry as hidden/unrendered text). A date-shaped
    // string that failed dateRe (e.g. "0-Jan-00") still contains letters
    // ("Jan") but must not be mistaken for the type either.
    const typeItem = row.filter((i) => i !== dateItem && /[A-Za-z]/.test(i.text) && !LOOSE_DATE_SHAPE.test(i.text.trim())).sort((a, b) => a.x - b.x)[0];
    const type = typeItem ? typeItem.text.toUpperCase() : "";
    const date = dateItem ? dateItem.text : "";
    if (type || date) out.push([type, date]);
  }
  return out;
}

// Row labels (aircraft type names) have no fixed spelling across pilots'
// PDFs - the same fleet shows up as "S76C+/C++", "SK76", "S76D", "BELL206",
// "B-206", "Bell 206", etc, plus fixed-wing types (Cessna, Piper, Diamond...)
// never enumerable up front. So instead of matching a name whitelist, this
// looks at every visual row that contains an "H:MM" value and treats the
// leftmost non-hour, non-table-chrome text on each side of the page (left
// table vs right table) as that row's aircraft name.
const TABLE_CHROME = /^(PIC|PICUS|SIC|Total|Total\s*Type|Type|Hours?|Rotary-Wing|Fixed-Wing|\(?S-Engine\)?|\(?Multi-Engine\)?|Total\s*Single|Total\s*Multi|Total\s*Pic\s*&?\s*Sic|Total\s*of\s*Helicopter|Total\s*of\s*Fixed[- ]?wing|Grand\s*Total\s*Hours|IFR\(IMC\)|Night|Offshore|TRI|TRE|Specialty|Sim\.?Type|Date\s*Last\s*Attended)$/i;

function getAircraftTables(items, allText) {
  const result = {
    rotarySingle: [],
    fixedSingle: [],
    rotaryMulti: [],
    fixedMulti: [],
    totalsFromPdf: { grand: (allText.match(/Grand Total Hours\s*(\d+:\d{2})/i) || [])[1] || "" }
  };

  const pageBoundsCache = {};
  const byPage = {};
  for (const it of items) (byPage[it.page] = byPage[it.page] || []).push(it);

  for (const pageKey in byPage) {
    const page = Number(pageKey);
    const { midX } = getPageBounds(page, items, pageBoundsCache);
    const rows = groupRows(byPage[page], 6);
    const sides = [
      { test: (x) => x < midX },
      { test: (x) => x >= midX }
    ];

    for (const row of rows) {
      for (const side of sides) {
        const band = row.filter((i) => side.test(i.x));
        const hourItems = band.filter((i) => isHour(i.text));
        if (!hourItems.length) continue;

        const label = band
          .filter((i) => !isHour(i.text) && /[A-Za-z]/.test(i.text) && !TABLE_CHROME.test(i.text.trim()) && !LOOSE_DATE_SHAPE.test(i.text.trim()))
          .sort((a, b) => a.x - b.x)[0];
        if (!label || isSimulatorCell(label, items)) continue;

        const { group, xMin, xMax } = classifyAircraft(label, items, pageBoundsCache);
        const rowData = aircraftRowByColumns(label, items, group, xMin, xMax);
        if (!rowData) continue;
        if (!result[group].some((r) => r.join("|") === rowData.join("|"))) result[group].push(rowData);
      }
    }
  }
  return result;
}

// Splits each page into 4 quadrants (rotary/fixed x single/multi) and returns,
// along with the group, the horizontal [xMin, xMax) band that belongs to that
// aircraft's own table. Row/column lookups are then clamped to this band so
// hour values from the neighbouring table on the same page-row can never
// bleed across into the wrong table (the root cause of PIC/PICUS/SIC/Total
// values landing in the wrong column when two tables share a text row).
function getPageBounds(page, items, cache) {
  if (cache[page]) return cache[page];

  const pageItems = items.filter((i) => i.page === page);
  const maxX = Math.max(...pageItems.map((i) => i.x));
  const maxY = Math.max(...pageItems.map((i) => i.y));

  // The left and right tables are not always symmetric halves of the page
  // (the rotary table's own "Total" column can extend past the page's exact
  // midpoint), so page-width/2 is not a safe split line. Instead, find the
  // real visual gap between the two tables using the PIC/PICUS/SIC column
  // header x-positions: sort them and take the midpoint of the largest gap.
  const headerXs = pageItems
    .filter((i) => /^(PIC|PICUS|SIC)$/i.test(i.text.trim()))
    .map((i) => i.x)
    .sort((a, b) => a - b);

  let midX = maxX * 0.5;
  let bestGap = -1;
  for (let k = 1; k < headerXs.length; k++) {
    const gap = headerXs[k] - headerXs[k - 1];
    if (gap > bestGap) {
      bestGap = gap;
      midX = (headerXs[k] + headerXs[k - 1]) / 2;
    }
  }

  cache[page] = { maxX, maxY, midX };
  return cache[page];
}

function classifyAircraft(item, items, cache) {
  const { maxY, midX } = getPageBounds(item.page, items, cache);
  const left = item.x < midX;
  const upper = item.y < maxY * 0.58;

  const group = left
    ? (upper ? "rotarySingle" : "rotaryMulti")
    : (upper ? "fixedSingle" : "fixedMulti");

  return {
    group,
    xMin: left ? -Infinity : midX,
    xMax: left ? midX : Infinity
  };
}

function aircraftRowByColumns(aircraft, items, group, xMin, xMax) {
  const rowBand = items.filter((i) =>
    i.page === aircraft.page &&
    Math.abs(i.y - aircraft.y) < 9 &&
    i.x > Math.max(aircraft.x - 3, xMin) &&
    i.x < Math.min(aircraft.x + 430, xMax)
  );

  const hourItems = rowBand.filter((i) => isHour(i.text));
  if (!hourItems.length) return null;

  const header = detectColumnHeaders(aircraft, items, group, xMin, xMax);
  const mapped = { pic: "0:00", picus: "0:00", sic: "0:00", total: "0:00" };

  for (const h of hourItems) {
    const key = nearestColumn(h.x, header, group);
    mapped[key] = h.text;
  }

  return [aircraft.text.toUpperCase(), mapped.pic, mapped.picus, mapped.sic, mapped.total];
}

function detectColumnHeaders(aircraft, items, group, xMin, xMax) {
  const searchBox = items.filter((i) =>
    i.page === aircraft.page &&
    i.y < aircraft.y &&
    i.y > aircraft.y - 75 &&
    i.x > aircraft.x &&
    i.x < Math.min(aircraft.x + 430, xMax)
  );

  const pic = searchBox.filter((i) => /^PIC$/i.test(i.text)).sort((a,b)=>b.y-a.y)[0];
  const picus = searchBox.filter((i) => /^PICUS$/i.test(i.text)).sort((a,b)=>b.y-a.y)[0];
  const sic = searchBox.filter((i) => /^SIC$/i.test(i.text)).sort((a,b)=>b.y-a.y)[0];
  const total = searchBox.filter((i) => /Total/i.test(i.text)).sort((a,b)=>b.y-a.y)[0];

  const fallback = group.includes("fixed")
    ? { pic: aircraft.x + 92, picus: aircraft.x + 170, sic: aircraft.x + 245, total: aircraft.x + 330 }
    : { pic: aircraft.x + 95, picus: aircraft.x + 180, sic: aircraft.x + 265, total: aircraft.x + 355 };

  return {
    pic: pic ? pic.x : fallback.pic,
    picus: picus ? picus.x : fallback.picus,
    sic: sic ? sic.x : fallback.sic,
    total: total ? total.x : fallback.total
  };
}

function nearestColumn(x, columns, group) {
  const keys = group.includes("fixed") ? ["pic", "sic", "total"] : ["pic", "picus", "sic", "total"];
  let best = keys[0];
  let bestD = Infinity;
  for (const k of keys) {
    const d = Math.abs(x - columns[k]);
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return best;
}

function isSimulatorCell(item, items) {
  const sim = items.find((i) => /Sim\.?Type/i.test(i.text));
  if (!sim) return false;
  return item.page === sim.page && item.y > sim.y && item.y < sim.y + 105 && item.x > sim.x - 25 && item.x < sim.x + 330;
}

function rightText(items, label, options = {}) {
  if (!label) return "";
  const maxDx = options.maxDx ?? 260;
  const maxDy = options.maxDy ?? 12;
  const reject = options.reject;
  const accept = options.accept;
  const values = items
    .filter((i) => i.page === label.page && i.x > label.x && i.x - label.x < maxDx && Math.abs(i.y - label.y) < maxDy)
    .filter((i) => !reject || !reject.test(i.text))
    .filter((i) => !accept || accept.test(i.text))
    .sort((a, b) => a.x - b.x)
    .map((i) => i.text);
  return values.join(" ").trim();
}

function hourRightOf(items, regex) {
  const label = items.find((i) => regex.test(i.text));
  if (!label) return "";
  const h = items
    .filter((i) => i.page === label.page && isHour(i.text) && Math.abs(i.y - label.y) < 10 && i.x > label.x)
    .sort((a, b) => a.x - b.x)[0];
  return h ? h.text : "";
}

function getHourByIndex(text, index) {
  const hours = String(text || "").match(/\d+:\d{2}/g) || [];
  return hours[index] || "";
}

function groupRows(items, tolerance = 8) {
  const rows = [];
  for (const item of items.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find((r) => Math.abs(r.y - item.y) < tolerance);
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x));
}

// Turns a pdf.js document into the positioned text runs the parser wants.
// Works with the browser build and the Node/legacy build alike - it only
// touches the public page API, which is identical in both.
export async function pdfItemsFromDocument(pdf) {
  const items = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.0 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      const text = String(item.str || "").trim();
      if (!text) continue;
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      items.push({
        page: p,
        x: Number(transform[4]),
        // pdf.js measures y from the BOTTOM; everything here reads top-down.
        y: Number(viewport.height - transform[5]),
        text,
        width: Number(item.width || 0),
        height: Number(item.height || 0)
      });
    }
  }
  return mergeFragments(items.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x));
}

// The whole job, given a pdf.js document: positions in, record out.
export async function parseExperienceFromDocument(pdf, fileName) {
  return parseExperience(await pdfItemsFromDocument(pdf), fileName);
}
