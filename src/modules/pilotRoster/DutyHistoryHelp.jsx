import { Fragment, useState } from "react";
import manualTh from "../../../manuals/Duty-Flight-History-Crew-Scheduler.md?raw";
import manualEn from "../../../manuals/Duty-Flight-History-Crew-Scheduler.en.md?raw";

// The Help tab of Duty & Flight History: the crew scheduler manual, in Thai or
// English. The text comes straight from manuals/*.md, so the in-app help and
// the manual in the repo are always the same document.

const MANUALS = { th: manualTh, en: manualEn };
const LANG_KEY = "avicore.dutyHistoryHelp.lang";

function readLang() {
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    return v === "en" || v === "th" ? v : "th";
  } catch {
    return "th";
  }
}

function saveLang(v) {
  try { window.localStorage.setItem(LANG_KEY, v); } catch { /* storage blocked */ }
}

// **bold** -> <b>; everything else stays text.
function inline(text, keyBase) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <b key={`${keyBase}-${i}`}>{part.slice(2, -2)}</b>
      : <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>);
}

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

// A small Markdown reader for the manual's own subset: # / ## / ### headings,
// paragraphs, - and 1. lists, | tables |, and **bold**.
export function parseManual(md) {
  const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ type: "h", level: h[1].length, text: h[2] }); i++; continue; }
    if (line.trim().startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      const body = rows.filter((r, n) => n !== 1 || !/^\|?\s*:?-{3,}/.test(r.trim()));
      blocks.push({ type: "table", head: cells(body[0]), rows: body.slice(1).map(cells) });
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) items.push(lines[i++].replace(/^\d+\.\s+/, ""));
      blocks.push({ type: "ol", items });
      continue;
    }
    if (/^-\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^-\s/.test(lines[i])) items.push(lines[i++].replace(/^-\s+/, ""));
      blocks.push({ type: "ul", items });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\||\d+\.\s|-\s)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}

function Block({ block, k }) {
  switch (block.type) {
    case "h": {
      const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
      return <Tag className={`dhhelp-h${block.level}`}>{inline(block.text, k)}</Tag>;
    }
    case "table":
      return (
        <div className="dhhelp-tablewrap">
          <table className="dhhelp-table">
            <thead><tr>{block.head.map((c, n) => <th key={n}>{inline(c, `${k}h${n}`)}</th>)}</tr></thead>
            <tbody>
              {block.rows.map((r, rn) => (
                <tr key={rn}>{r.map((c, n) => <td key={n}>{inline(c, `${k}r${rn}c${n}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "ol":
      return <ol>{block.items.map((t, n) => <li key={n}>{inline(t, `${k}i${n}`)}</li>)}</ol>;
    case "ul":
      return <ul>{block.items.map((t, n) => <li key={n}>{inline(t, `${k}i${n}`)}</li>)}</ul>;
    default:
      return <p>{inline(block.text, k)}</p>;
  }
}

export default function DutyHistoryHelp() {
  const [lang, setLang] = useState(readLang);
  const choose = (v) => { setLang(v); saveLang(v); };
  const blocks = parseManual(MANUALS[lang]);
  return (
    <div className="dhhelp" lang={lang}>
      <div className="dhhelp-langbar no-print" role="group" aria-label="Language">
        <button type="button" className={lang === "th" ? "active" : ""} aria-pressed={lang === "th"} onClick={() => choose("th")}>ไทย</button>
        <button type="button" className={lang === "en" ? "active" : ""} aria-pressed={lang === "en"} onClick={() => choose("en")}>English</button>
      </div>
      <article className="dhhelp-body">
        {blocks.map((b, n) => <Block key={`${lang}-${n}`} k={`${lang}-${n}`} block={b} />)}
      </article>
    </div>
  );
}
