import { SECTION_BY_KEY, MIN_REST_HOURS } from "./weeklyPlanSections.js";
import { MAX_NIGHT_DAYS_PER_CYCLE, WORK_CYCLE_DAYS } from "./weeklyPlanRules.js";
import { rollingSum } from "./weeklyPlanHeadroom.js";
import { classifyTourDay } from "./weeklyPlanTourDays.js";
import { activePairsOn } from "./weeklyPlanTrainingPairs.js";
import { todayIso } from "../../utils/dateKeys.js";

// The Weekly Schedule assistant.
//
// It answers from the ACTUAL DATA on the page and executes commands against
// it. There is deliberately no language model behind it, and that is the
// point: every answer is computed from the same functions the planner and the
// checks use, so it cannot invent an FTL rule, misremember a limit, or
// confidently give a wrong answer about who is legal to fly. If it doesn't
// know something it says so.
//
// It replies in the language it was asked in. Thai and English are written
// out side by side rather than machine-translated, because the wording of a
// duty-limit answer has to be exactly right in both.

export function detectLanguage(text) {
  // Any Thai character means the question was asked in Thai. A pilot code or
  // a time written in Latin letters inside a Thai sentence doesn't change
  // that, which is why this looks for the presence of Thai rather than the
  // absence of English.
  return /[฀-๿]/.test(String(text || "")) ? "th" : "en";
}

// Picks the right side of a bilingual pair. Written as a function rather than
// an object lookup so every call site reads as one line.
function say(lang, en, th) {
  return lang === "th" ? th : en;
}

function norm(text) {
  return String(text || "").trim().toLowerCase();
}

function findPilotCode(text, knownCodes) {
  const upper = String(text || "").toUpperCase();
  const codes = [...(knownCodes || [])].sort((a, b) => b.length - a.length);
  return codes.find((c) => new RegExp(`\\b${c}\\b`).test(upper)) || null;
}

// "tomorrow" / "พรุ่งนี้" / "friday" / "วันศุกร์" / "22" / "2026-07-22"
function findDate(text, days) {
  const t = norm(text);
  const iso = t.match(/\d{4}-\d{2}-\d{2}/);
  if (iso && days.some((d) => d.iso === iso[0])) return iso[0];

  const today = todayIso();
  if (/tomorrow|พรุ่งนี้/.test(t)) {
    const idx = days.findIndex((d) => d.iso > today);
    if (idx >= 0) return days[idx].iso;
  }
  if (/today|วันนี้/.test(t)) {
    return days.find((d) => d.iso === today)?.iso || null;
  }

  const WEEKDAYS = [
    ["sun", "อาทิตย์", 0], ["mon", "จันทร์", 1], ["tue", "อังคาร", 2],
    ["wed", "พุธ", 3], ["thu", "พฤหัส", 4], ["fri", "ศุกร์", 5], ["sat", "เสาร์", 6]
  ];
  for (const [en, th, dow] of WEEKDAYS) {
    if (!t.includes(en) && !t.includes(th)) continue;
    const match = days.find((d) => new Date(d.iso + "T00:00:00").getDay() === dow);
    if (match) return match.iso;
  }

  const dayNum = t.match(/(?:^|\s)(\d{1,2})(?:\s|$)/);
  if (dayNum) {
    const match = days.find((d) => d.dayNum === Number(dayNum[1]));
    if (match) return match.iso;
  }
  return null;
}

function findSectionKey(text) {
  const t = norm(text);
  if (/night|ไนท์|กลางคืน/.test(t)) return "nightStandby1";
  const crew = t.match(/crew\s*([1-6])|ชุด\s*([1-6])/);
  if (crew) return `crew${crew[1] || crew[2]}`;
  return null;
}

function sectionLabel(key, lang) {
  const s = SECTION_BY_KEY.get(key);
  if (!s) return key;
  if (lang !== "th") return s.label;
  if (s.kind === "night") return "ไนท์สแตนด์บาย";
  return s.label.replace("Crew", "ชุด");
}

function fmtHours(h) {
  if (h == null) return "-";
  const sign = h < 0 ? "-" : "";
  const abs = Math.abs(h);
  return `${sign}${Math.floor(abs)}:${String(Math.round((abs - Math.floor(abs)) * 60)).padStart(2, "0")}`;
}

// --- Intents ---------------------------------------------------------------
// run(ctx, text, lang) -> { text, actions? }

const INTENTS = [
  {
    id: "help",
    test: (t) => /^(help|\?|ช่วย|ทำอะไรได้|ใช้ยังไง)/.test(t),
    run: (ctx, text, lang) => ({
      text: lang === "th" ? [
        "ผมตอบจากแผนที่อยู่บนหน้าจอ และแก้ตารางให้ได้ (ค้างไว้ให้ตรวจก่อน)",
        "",
        "**ถามได้**",
        "· ใครว่างวันศุกร์",
        "· ทำไม CSU ไม่ถูกจัด",
        "· ใครใกล้ชนลิมิต",
        "· WJU เข้าไนท์กี่คืน",
        "· ดู WJU",
        "· กฎไนท์ / กฎพัก / กฎจับคู่",
        "",
        "**สั่งได้**",
        "· ย้าย WJU ไป Crew 2 วันพุธ",
        "· เอา NSO ออกวันศุกร์",
        "· เคลียร์ Crew 4 วันพฤหัส",
        "",
        "ทุกการแก้จะค้างไว้ในตาราง ยังไม่บันทึกจนกว่าจะกด Save"
      ].join("\n") : [
        "I answer from the plan on screen and can make changes for you to review.",
        "",
        "**Ask me**",
        "· who is free on Friday",
        "· why isn't CSU planned",
        "· who is close to a limit",
        "· how many nights has WJU had",
        "· show WJU",
        "· rules for night / rest / pairing",
        "",
        "**Tell me**",
        "· put WJU on Crew 2 on Wednesday",
        "· remove NSO from Friday",
        "· clear Crew 4 on Thursday",
        "",
        "Changes are staged in the grid — nothing is saved until you press Save."
      ].join("\n")
    })
  },

  {
    id: "whoFree",
    test: (t) => /(who.*(free|available|spare))|ใคร.*ว่าง|คนว่าง/.test(t),
    run: (ctx, text, lang) => {
      const date = findDate(text, ctx.days) || ctx.days[0].iso;
      const onDuty = ctx.onDutyOn(date);
      const used = ctx.assignedOn(date);
      const free = onDuty.filter((c) => !used.has(c));

      if (!onDuty.length) {
        return { text: say(lang,
          `No roster data for ${date} — import the Duty Schedule for that period first.`,
          `ไม่มีข้อมูล roster ของวันที่ ${date} — ต้อง import Duty Schedule ของช่วงนั้นก่อนครับ`) };
      }
      if (!free.length) {
        return { text: say(lang,
          `Everyone rostered on duty on ${date} is already assigned (${onDuty.length} pilots).`,
          `วันที่ ${date} คนที่ on duty ถูกจัดหมดแล้วทั้ง ${onDuty.length} คนครับ`) };
      }

      const lines = free.map((c) => {
        const tour = classifyTourDay(ctx.rosterByPilotDate, c, date);
        const tags = lang === "th" ? [
          ctx.positionsByCode[c] === "Captain" ? "กัปตัน" : "โคไพลอต",
          tour.firstDay ? "วันแรกกลับมา" : "",
          tour.lastDay ? "วันสุดท้าย" : "",
          ctx.nightCurrentByCode.has(c) ? "" : "ไนท์หมดอายุ"
        ] : [
          ctx.positionsByCode[c] === "Captain" ? "Capt" : "F/O",
          tour.firstDay ? "first day back" : "",
          tour.lastDay ? "last day" : "",
          ctx.nightCurrentByCode.has(c) ? "" : "no night currency"
        ];
        return `· **${c}** — ${tags.filter(Boolean).join(", ")}`;
      });

      return { text: say(lang,
        `On duty but unassigned on ${date} (${free.length} of ${onDuty.length}):\n\n${lines.join("\n")}`,
        `วันที่ ${date} on duty แต่ยังไม่ถูกจัด ${free.length} คน จาก ${onDuty.length} คน:\n\n${lines.join("\n")}`) };
    }
  },

  {
    id: "whyNot",
    test: (t) => /(why).*(not|isn'?t|can'?t)|ทำไม.*(ไม่|จัดไม่)/.test(t),
    run: (ctx, text, lang) => {
      const code = findPilotCode(text, ctx.allCodes);
      if (!code) {
        return { text: say(lang,
          "Which pilot? Give me the 3-letter code, e.g. “why isn't CSU planned on Friday”.",
          "นักบินคนไหนครับ ใส่รหัส 3 ตัว เช่น “ทำไม CSU ไม่ถูกจัดวันศุกร์”") };
      }
      const date = findDate(text, ctx.days) || ctx.days[0].iso;

      const assigned = ctx.assignmentFor(code, date);
      if (assigned) {
        return { text: say(lang,
          `**${code}** *is* planned on ${date}: ${sectionLabel(assigned.section, "en")}.`,
          `**${code}** ถูกจัดแล้วครับ วันที่ ${date}: ${sectionLabel(assigned.section, "th")}`) };
      }

      const reasons = [];
      const rosterCode = ctx.rosterByPilotDate.get(`${code}|${date}`);
      if (!rosterCode) {
        reasons.push(say(lang, "the roster has no entry for that day", "roster ไม่มีข้อมูลของวันนั้น"));
      } else if (!["O", "N", "ND"].includes(String(rosterCode).toUpperCase())) {
        reasons.push(say(lang,
          `the roster shows **${rosterCode}** — not a working day`,
          `roster ลงไว้ว่า **${rosterCode}** — ไม่ใช่วันทำงาน`));
      }

      const availability = ctx.availabilityByCode.get(code);
      if (availability?.blocked) {
        reasons.push(...availability.reasons.filter((r) => r.level === "exc").map((r) => r.text));
      }

      const overdue = ctx.trainingOverdueByCode.get(code);
      if (overdue) reasons.push(say(lang, `training overdue: ${overdue}`, `training หมดอายุ: ${overdue}`));

      const nights = ctx.nightDaysInCycle(code, date);
      if (nights >= MAX_NIGHT_DAYS_PER_CYCLE) {
        reasons.push(say(lang,
          `already ${nights} nights in the last ${WORK_CYCLE_DAYS} days (cap ${MAX_NIGHT_DAYS_PER_CYCLE})`,
          `เข้าไนท์ไปแล้ว ${nights} คืนใน ${WORK_CYCLE_DAYS} วัน (เพดาน ${MAX_NIGHT_DAYS_PER_CYCLE})`));
      }

      const directive = activePairsOn(ctx.trainingPairs, date).find((p) => p.pilotCode === code);
      if (directive) {
        const withWho = directive.withCode === "ANY_INSTRUCTOR"
          ? say(lang, "an instructor", "ครูคนไหนก็ได้")
          : directive.withCode;
        reasons.push(say(lang,
          `must fly with ${withWho} until ${directive.to || "further notice"}`,
          `ต้องบินกับ ${withWho} จนถึง ${directive.to || "จนกว่าจะยกเลิก"}`));
      }

      if (!reasons.length) {
        return { text: say(lang,
          `**${code}** is available on ${date} — nothing is blocking them. They were probably just not needed: the seats were filled by pilots carrying less duty, or leaving them out kept everyone below the warning line.`,
          `**${code}** ว่างและไม่ติดอะไรเลยครับ วันที่ ${date} — น่าจะแค่ไม่ได้ใช้ เพราะที่นั่งถูกเติมด้วยคนที่สะสมชั่วโมงน้อยกว่า หรือเว้นไว้เพื่อไม่ให้ใครแตะเส้นเหลือง`) };
      }
      return { text: `**${code}** ${say(lang, "on", "วันที่")} ${date}:\n\n${reasons.map((r) => `· ${r}`).join("\n")}` };
    }
  },

  {
    id: "nearLimit",
    test: (t) => /(close|near|approach).*(limit)|ใกล้.*(ลิมิต|เพดาน)|เหลือ.*ชั่วโมง|ใครเกิน/.test(t),
    run: (ctx, text, lang) => {
      const rows = [];
      for (const code of ctx.allCodes) {
        const a = ctx.availabilityByCode.get(code);
        if (a && a.severity !== "ok") rows.push(`· **${code}** — ${a.reasons.map((r) => r.text).join("; ")}`);
      }
      if (!rows.length) {
        return { text: say(lang,
          "Nobody is close to a duty or flight-time limit. Everyone has room.",
          "ไม่มีใครใกล้ชนลิมิตชั่วโมง duty หรือ flight time ครับ ทุกคนยังมีที่เหลือ") };
      }
      return { text: say(lang,
        `${rows.length} pilot${rows.length > 1 ? "s" : ""} at or near a limit:\n\n${rows.join("\n")}`,
        `มี ${rows.length} คนที่ชนหรือใกล้ชนลิมิต:\n\n${rows.join("\n")}`) };
    }
  },

  {
    id: "nightCount",
    test: (t) => /(how many).*(night)|(night).*(count|how many)|เข้าไนท์.*(กี่|จำนวน)|กี่คืน/.test(t),
    run: (ctx, text, lang) => {
      const code = findPilotCode(text, ctx.allCodes);
      const asOf = ctx.days[ctx.days.length - 1].iso;
      if (code) {
        const n = ctx.nightDaysInCycle(code, asOf);
        return { text: say(lang,
          `**${code}** has ${n} night dut${n === 1 ? "y" : "ies"} in the ${WORK_CYCLE_DAYS} days to ${asOf} — the cap is ${MAX_NIGHT_DAYS_PER_CYCLE}.`,
          `**${code}** เข้าไนท์ ${n} คืน ใน ${WORK_CYCLE_DAYS} วันถึง ${asOf} — เพดาน ${MAX_NIGHT_DAYS_PER_CYCLE} คืนครับ`) };
      }
      const rows = ctx.allCodes
        .map((c) => ({ c, n: ctx.nightDaysInCycle(c, asOf) }))
        .filter((r) => r.n > 0)
        .sort((a, b) => b.n - a.n)
        .map((r) => `· **${r.c}** — ${r.n}${r.n >= MAX_NIGHT_DAYS_PER_CYCLE ? say(lang, " (at the cap)", " (เต็มเพดานแล้ว)") : ""}`);
      if (!rows.length) {
        return { text: say(lang, "No night duties planned in this cycle.", "ยังไม่มีใครถูกจัดไนท์ในรอบนี้ครับ") };
      }
      return { text: say(lang,
        `Night duties in the ${WORK_CYCLE_DAYS} days to ${asOf} (cap ${MAX_NIGHT_DAYS_PER_CYCLE}):\n\n${rows.join("\n")}`,
        `จำนวนคืนที่เข้าไนท์ ใน ${WORK_CYCLE_DAYS} วันถึง ${asOf} (เพดาน ${MAX_NIGHT_DAYS_PER_CYCLE}):\n\n${rows.join("\n")}`) };
    }
  },

  {
    id: "showPilot",
    test: (t) => /^(show|ดู|สถานะ)\s|status of|ตาราง.*ของ/.test(t),
    run: (ctx, text, lang) => {
      const code = findPilotCode(text, ctx.allCodes);
      if (!code) {
        return { text: say(lang,
          "Which pilot? Give me the 3-letter code, e.g. “show WJU”.",
          "นักบินคนไหนครับ ใส่รหัส 3 ตัว เช่น “ดู WJU”") };
      }
      const week = ctx.days.map((d) => {
        const a = ctx.assignmentFor(code, d.iso);
        const label = a ? sectionLabel(a.section, lang) : (ctx.rosterByPilotDate.get(`${code}|${d.iso}`) || "—");
        return `· ${d.weekday} ${d.dayNum} — ${label}`;
      });
      const asOf = ctx.days[ctx.days.length - 1].iso;
      const dt7 = rollingSum(ctx.plannedDutyByDate(code), asOf, 7);
      const level = ctx.levelByCode.get(code);
      const bits = lang === "th" ? [
        ctx.positionsByCode[code] === "Captain" ? "กัปตัน" : (ctx.positionsByCode[code] || "?"),
        level != null ? `Level ${level}` : "คำนวณ Level ไม่ได้",
        ctx.nightCurrentByCode.has(code) ? "ไนท์ current" : "ไนท์หมดอายุ",
        `เข้าไนท์ ${ctx.nightDaysInCycle(code, asOf)} คืนรอบนี้`,
        `duty 7 วัน ≈ ${fmtHours(dt7)}`
      ] : [
        `Position ${ctx.positionsByCode[code] || "?"}`,
        level != null ? `Experience Level ${level}` : "Experience Level not computable",
        ctx.nightCurrentByCode.has(code) ? "night current" : "night currency expired",
        `${ctx.nightDaysInCycle(code, asOf)} nights this cycle`,
        `duty 7d ≈ ${fmtHours(dt7)}`
      ];
      return { text: `**${code}** — ${bits.join(" · ")}\n\n${week.join("\n")}` };
    }
  },

  {
    id: "rules",
    test: (t) => /(rule|กฎ|เงื่อนไข|ระเบียบ)/.test(t),
    run: (ctx, text, lang) => {
      const t = norm(text);
      if (/night|ไนท์|กลางคืน/.test(t)) {
        return { text: lang === "th" ? [
          "**กฎไนท์**",
          "· ทั้งสองคนต้องมี Night Currency ที่ยังไม่หมดอายุ (จาก Training) — ไม่ได้กรอกวันที่ = ถือว่าหมดอายุ",
          `· ไม่เกิน **${MAX_NIGHT_DAYS_PER_CYCLE} คืน ต่อรอบ ${WORK_CYCLE_DAYS} วัน**`,
          "· นับ duty แค่ 25% ของ 12 ชม. = 3 ชม. เลยไม่กินโควตาชั่วโมงสะสม",
          "· ออกไนท์ 05:30 บวกพัก 12 ชม. = รายงานตัวครั้งถัดไปเร็วสุด 17:30 — ต่อไนท์ได้ แต่บินเช้าวันรุ่งขึ้นไม่ได้",
          "· วันแรกที่กลับจากหยุด 7 วัน ไม่จัดไนท์เด็ดขาด",
          "· วันสุดท้ายเข้าไนท์ได้ แต่ต้องแจ้งนักบินล่วงหน้า เพราะปกติจองตั๋วกลับบ้านประมาณ 20:00"
        ].join("\n") : [
          "**Night line**",
          "· Both pilots need valid Night Currency (Training tab). No date recorded counts as not current.",
          `· No more than **${MAX_NIGHT_DAYS_PER_CYCLE} nights per ${WORK_CYCLE_DAYS}-day cycle**.`,
          "· Duty booked is 25% of the 12 hours = 3 h, which is why nights don't eat the rolling limits.",
          "· Off at 05:30, so the earliest next report is 17:30 — night-to-night is fine, night-to-day-crew next morning is not.",
          "· First day back from the 7 days off is never given night.",
          "· Last day of tour on night is allowed but the pilot must be told in advance — they usually fly home about 20:00."
        ].join("\n") };
      }
      if (/rest|พัก/.test(t)) {
        return { text: say(lang,
          `**Rest** — ${MIN_REST_HOURS} h minimum between the end of one duty and the report time of the next. Coming off night at 05:30 that puts the earliest next report at 17:30.`,
          `**กฎพัก** — อย่างน้อย ${MIN_REST_HOURS} ชม. ระหว่างจบ duty กับเวลารายงานตัวครั้งถัดไป ออกไนท์ 05:30 เพราะฉะนั้นเร็วสุดคือ 17:30`) };
      }
      if (/pair|คู่|level/.test(t)) {
        return { text: say(lang,
          "**Pairing** — the two pilots' Experience Levels added must be at least 4 (OPS-CM-01 7.17.4), night or day. Never two Co-pilots. Where there's a choice, pilots are crewed with someone they haven't flown with recently, for CRM.",
          "**กฎจับคู่** — level ของสองคนบวกกันต้อง ≥ 4 (OPS-CM-01 7.17.4) ทั้งกลางวันและกลางคืน ห้ามโคไพลอตคู่กันเอง และถ้าเลือกได้จะจับกับคนที่ไม่ได้บินด้วยกันมานาน เพื่อ CRM") };
      }
      return { text: say(lang,
        "I can explain the rules for **night**, **rest**, or **pairing**. The full write-up with reasoning is in docs/WEEKLY-SCHEDULE-RULES.md.",
        "ผมอธิบายกฎ **ไนท์**, **การพัก**, หรือ **การจับคู่** ได้ครับ ฉบับเต็มพร้อมเหตุผลอยู่ใน docs/WEEKLY-SCHEDULE-RULES.md") };
    }
  },

  {
    id: "assign",
    // \b matters: without it "remove" contains "move" and every removal was
    // being read as an assignment.
    test: (t) => (/\b(put|assign|move|swap)\b|ย้าย|จัดให้|ใส่/.test(t)) && !/\b(remove|clear)\b|เอา.*ออก|ลบ|เคลียร์/.test(t),
    run: (ctx, text, lang) => {
      const code = findPilotCode(text, ctx.allCodes);
      const date = findDate(text, ctx.days);
      const section = findSectionKey(text);

      if (!code) return { text: say(lang, "Which pilot? e.g. “put WJU on Crew 2 on Wednesday”.", "นักบินคนไหนครับ เช่น “ย้าย WJU ไป Crew 2 วันพุธ”") };
      if (!section) return { text: say(lang, `Which line? Crew 1-6 or Night.`, "ไลน์ไหนครับ Crew 1-6 หรือ ไนท์") };
      if (!date) return { text: say(lang, "Which day?", "วันไหนครับ") };

      const occupied = [0, 1].map((slot) => ctx.cellAt(date, section, slot));
      const freeSlot = occupied.findIndex((c) => !c?.pilotCode);
      if (freeSlot < 0) {
        const who = occupied.map((c) => c.pilotCode).join(" + ");
        return { text: say(lang,
          `${sectionLabel(section, "en")} on ${date} is already full (${who}). Remove someone first.`,
          `${sectionLabel(section, "th")} วันที่ ${date} เต็มแล้วครับ (${who}) เอาคนออกก่อน`) };
      }

      return {
        text: say(lang,
          `Staged: **${code}** → ${sectionLabel(section, "en")} on ${date}. Check the grid — it'll flag anything this breaks — then press Save.`,
          `ค้างไว้แล้ว: **${code}** → ${sectionLabel(section, "th")} วันที่ ${date} ดูในตารางได้เลย ถ้าผิดกฎจะขึ้นเตือน แล้วค่อยกด Save`),
        actions: [{ type: "set", date, section, slot: freeSlot, pilotCode: code }]
      };
    }
  },

  {
    id: "remove",
    test: (t) => /\b(remove|clear)\b|take .* off|เอา.*ออก|ลบ|เคลียร์|ยกเลิก/.test(t),
    run: (ctx, text, lang) => {
      const code = findPilotCode(text, ctx.allCodes);
      const date = findDate(text, ctx.days);
      const section = findSectionKey(text);

      if (code && date) {
        const a = ctx.assignmentFor(code, date);
        if (!a) return { text: say(lang, `**${code}** isn't assigned on ${date}.`, `**${code}** ไม่ได้ถูกจัดในวันที่ ${date} ครับ`) };
        return {
          text: say(lang,
            `Staged: removed **${code}** from ${sectionLabel(a.section, "en")} on ${date}. Press Save to commit.`,
            `ค้างไว้แล้ว: เอา **${code}** ออกจาก ${sectionLabel(a.section, "th")} วันที่ ${date} กด Save เพื่อบันทึก`),
          actions: [{ type: "clear", date, section: a.section, slot: a.slot }]
        };
      }
      if (section && date) {
        return {
          text: say(lang,
            `Staged: cleared ${sectionLabel(section, "en")} on ${date}. Press Save to commit.`,
            `ค้างไว้แล้ว: เคลียร์ ${sectionLabel(section, "th")} วันที่ ${date} กด Save เพื่อบันทึก`),
          actions: [0, 1].map((slot) => ({ type: "clear", date, section, slot }))
        };
      }
      return { text: say(lang,
        "Tell me who and when — e.g. “remove NSO from Friday”, or “clear Crew 4 on Thursday”.",
        "บอกว่าใครและวันไหนครับ เช่น “เอา NSO ออกวันศุกร์” หรือ “เคลียร์ Crew 4 วันพฤหัส”") };
    }
  }
];

export const UNKNOWN_MARKER = "__ASSISTANT_NO_INTENT__";

// forceLang renders the same computed answer in another language. Used when
// the machine has no Thai voice: the screen still shows Thai, but the spoken
// version is generated in English rather than left silent. It is a re-render,
// not a translation - the same intent runs again with the other wording.
export function askAssistant(question, ctx, { forceLang } = {}) {
  const t = norm(question);
  const lang = forceLang || detectLanguage(question);
  if (!t) {
    return { lang, text: say(lang, "Ask me something about the plan, or type **help**.", "ถามเรื่องตารางได้เลยครับ หรือพิมพ์ **ช่วย**") };
  }

  for (const intent of INTENTS) {
    if (!intent.test(t)) continue;
    try {
      return { lang, ...intent.run(ctx, question, lang) };
    } catch (err) {
      return { lang, text: say(lang, `I hit an error working that out: ${err.message}`, `เกิดข้อผิดพลาดตอนคำนวณครับ: ${err.message}`) };
    }
  }

  return {
    lang,
    unknown: true,
    text: say(lang, [
      "I don't know that one.",
      "",
      "I only answer from the plan and roster on this page — I don't guess, because a confident wrong answer about duty limits is worse than no answer.",
      "",
      "Type **help** to see what I can do."
    ].join("\n"), [
      "อันนี้ผมไม่รู้ครับ",
      "",
      "ผมตอบเฉพาะจากแผนและ roster ที่อยู่บนหน้านี้ ไม่เดา เพราะตอบผิดเรื่องลิมิตชั่วโมงแบบมั่นใจ แย่กว่าไม่ตอบ",
      "",
      "พิมพ์ **ช่วย** เพื่อดูว่าผมทำอะไรได้บ้าง"
    ].join("\n"))
  };
}

export { fmtHours };
