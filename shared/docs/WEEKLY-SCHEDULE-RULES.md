# Weekly Schedule — how the plan is built

How AviCore decides who flies which line each day, and **why**. Everything
here came from Capt. Weera; anything not yet confirmed is marked as such
rather than guessed at.

The numbers live in `src/modules/pilotRoster/weeklyPlanRules.js`. The code
that applies them is `weeklyPlanAutoFill.js` (building a plan) and
`weeklyPlanChecks.js` (checking one a human typed). This document is the
reasoning behind both — change a rule here *and* there, or they drift apart.

---

## The lines

**The time on the schedule is the SCHEDULED DEPARTURE, not the report time.**
Duty starts one hour earlier — the standard report buffer
(`dutyReportOffsetMinutes`, the same rule Daily Duty applies).

| Line | Sch. departure | Reports | Duty ends | Duty booked |
|---|---|---|---|---|
| Crew 1 | 06:30 | **05:30** | 17:30 | 12 h |
| Crew 2 | 07:00 | 06:00 | 17:30 | 11.5 h |
| Crew 3 | 07:30 | 06:30 | 17:30 | 11 h |
| Crew 4 | 08:00 | 07:00 | 17:30 | 10.5 h |
| Crew 5 | 08:30 | 07:30 | 17:30 | 10 h |
| Crew 6 | 09:00 | 08:00 | 17:30 | 9.5 h |
| Night Standby | — | 17:30 | 05:30 (+1) | **3 h** (25 % of 12) |

The night line is quoted as a duty time, not a departure, so no report buffer
is applied to it.

> **The first version of this planner had it wrong.** It treated 06:30 as the
> report time, which understated every day crew by a full hour — Crew 1 was
> booked at 11 h instead of 12 h, and with six crews that is six hours a day
> missing from the rolling totals. Corrected once Capt. Weera pointed out what
> the figure actually is. The page now prints both, *"dep 06:30 · report
> 05:30"*, so the distinction can't quietly go wrong again.

Each line is two pilots — a Captain plus one other.

**Crew 1 books 12 h, which is the single-duty-period maximum exactly.** Six
Crew-1 duties would be 72 h against a 60 h weekly limit, so the rolling totals
bite after five days, not six. This is why the roster's real capacity is lower
than the crew count suggests.

**Night Standby Crew 2 (18:00–06:00) is not planned.** It exists in the
source spreadsheet but there aren't enough pilots to man a second night pair,
so it was only ever an empty row. Re-add it in `weeklyPlanSections.js` if the
fleet grows.

**The night line is labelled "Night Standby", 17:30–05:30.** The sheet's older
wording *"Night Standby / Duty Crew, 17:30-05:00 / 19:30-05:30"* described two
different start times that are no longer flown as separate things. The
importer still matches the old text in the file — what is displayed and what
is matched are deliberately separate (`sublabel` vs `excelSublabels`), because
the first time they were the same field a rename truncated every night crew to
one pilot on import.

**OPC Training is not a line on this board.** Removed at Capt. Weera's
instruction: OPC is scheduled through Training Monitor, and the row was
permanently empty here. Training that *does* belong on the board goes in the
`Training` and `Night Training` rows. The label still exists in the
spreadsheet, where it simply acts as a group boundary for the importer.

---

## What each document owns

| Goes on the ROSTER | Goes on the WEEKLY SCHEDULE |
|---|---|
| Which days are worked (O) and not (X, RR, R) | Which line: Crew 1-6 |
| Leave and sickness (VL, SL) | **Night Standby** |
| Training and checks from the training plan — NT, CR, CAC, S, S/T, T, C, H, FIRE, FIRST, SMS, AVS, DGs, PBN … | Which two pilots crew together |
| Helideck inspection (INS) | |

Nothing appears in both. The roster is the pay document (21 working days per
cycle); the weekly schedule is the flying programme.

**The two are cross-checked against each other every time a plan is built or
opened**, inside the same two envelopes: **FDT limitations** (rolling
7/14/28-day duty, 7/28/365-day flight time, the 168-hour Recovery Rest cycle,
12-hour minimum rest) and **training due** (nothing expired, and a warning
when something is close with no slot booked). Since Rule 8, that check runs
in both directions: when either envelope is about to fail, the plan
*suggests* a change back to the roster — a rostered OFF, or a training
booking — rather than the gap only showing up as a blank seat on the weekly
board. The chief pilot ticks and books what he agrees with; nothing is
written on its own.

## Rule 1 — Only pilots the roster shows on duty

Taken from the published Duty Schedule calendar. **O** counts as on duty.
Everything else — X, RR, R, leave, training, inspection — does not, and the
planner will not use those pilots that day.

> **N and ND were removed from the roster** at Capt. Weera's instruction:
> *"ตัด N ออกจาก roster ไปเลย"*. Night is decided entirely by the weekly
> schedule, so the roster no longer says anything about it. Months already
> imported that still contain N or ND are read as ordinary duty days, so
> nothing breaks — the codes are simply no longer offered and no longer carry
> a meaning.

### What the roster decides, and what it doesn't

The two documents answer different questions, and confusing them leads to the
wrong design:

| | Answers | Authority over |
|---|---|---|
| **Duty Schedule (roster)** | *When* does this pilot work? | which days count toward the 21 working days of the cycle — this is what pay is calculated from |
| **Weekly Schedule (plan)** | *What* do they do that day? | which line: Crew 1-6, night, training |

The two documents no longer overlap at all. The roster says only **whether**
a pilot works that day; the weekly schedule decides **what** they do with it,
including night. Carrying night in both places meant a night duty could be
recorded in one and not the other, with no way to tell which was right.

### The 168-hour Duty Cycle — what it actually is

The rule that decides *when* a Recovery Rest becomes necessary, and the reason
the 21/7 rotation has RR days in it at all.

**It is not a 168-hour rest, and it is not an hours ceiling.** It is a countdown
between one Recovery Rest and the next (OPS-CM-01 7.12.4):

> From the moment the last qualifying Recovery Rest **ended**, the next one must
> **start** within **168 hours** (7 days).

In plain terms: *never more than seven days of working without a long rest.* The
rolling 60/110/190 h duty limits are a separate constraint entirely — a pilot can
be comfortably inside all three and still be out of cycle, because this clock
counts elapsed time, not hours worked. That is why a template built before any
hours are flown still needs an RR pair: the clock runs regardless.

**A rest only counts as a Recovery Rest if it meets BOTH conditions:**

1. **≥ 36 hours** continuous, and
2. it covers **two local nights** (22:00–08:00), each giving **≥ 8 hours** of
   sleep opportunity.

Condition 2 is the one that catches people. A 40-hour break that straddles only
one night does **not** qualify — two actual nights of sleep are required.

**The three states FDT Monitor shows:**

| State | When | Effect on planning |
|---|---|---|
| **ok** (green) | under **132 h** elapsed | none |
| **warn** (yellow) | **132 h** reached | may still be planned, but reported: *"168h duty cycle running out — schedule a Recovery Rest"* |
| **exc** (red) | **168 h** reached | **blocked** — the pilot needs a Recovery Rest, not another duty |

132 is not an arbitrary threshold: it is 168 − 36. At that point exactly enough
time remains to fit a full Recovery Rest before the deadline; past it, there is
no longer room to complete one in time.

**Details the implementation gets right, and which are easy to get wrong:**

- **Measured from real Duty Periods, not raw log times.** The report-time buffer
  (1 h before departure) and the post-flight buffer are removed first, because
  actual rest begins only after duty ends. Measuring from raw entry timestamps
  would overstate rest by up to both buffers combined and could pass a gap that
  is genuinely too short.
- **A rest still in progress counts.** A pilot three days into their days off has
  no "next duty" to close the gap yet; without this they would wrongly read as
  overdue. The UI distinguishes **"On Process"** (resting, not yet 36 h/2 nights)
  from **"Resting"** (already qualifying).
- **The elapsed figure stops when logging stops.** It is anchored to the end of
  the last logged duty rather than the live clock, so it does not keep climbing
  on its own. Accepted trade-off, documented in `dutyPeriods.js`: a pilot who
  logs nothing at all for 168+ hours will not turn red from elapsed time alone —
  the figure simply stops moving.

Computed in `checkRecoveryRest168()` (`src/utils/dutyPeriods.js`), with the
figures in `ftlLimits.js` (`recoveryRest*`, overridable from Settings → FTL
Limits). The Weekly Schedule reads the *same* result via
`weeklyPlanAvailability.js`, so a pilot who is red on FDT Monitor can never
quietly appear on next week's plan.

**This is also what makes mid-rotation RR movable and the pre-OFF RR fixed.** A
mid-rotation RR exists to keep the pilot inside this clock, so it may be shifted
provided the cycle still works out. The RR pair before the 7-day break exists so
the pilot rests *before travelling home* — moving it defeats its purpose.

### RR and R are different things

Both are rest, and they are **not** interchangeable. Confirmed by Capt. Weera:

| | **RR** — Recovery Rest | **R** — Rest Day |
|---|---|---|
| Length | **≥ 36 hours** | **12 hours** (05:30–17:30) |
| Must contain | **two consecutive local nights** in the 22:00–08:00 window, each allowing **≥ 8 hours' sleep** | nothing further |
| What it discharges | **Resets the 168-hour duty cycle** | the minimum-rest requirement only — it does **not** reset the cycle |
| Typically follows | a duty run, or sits before the OFF block | coming **off a night** duty |
| Next day | pilot is off | pilot **may be rostered for duty**, provided the 168-hour cycle and rolling FT/DT limits still allow it |
| Pay / HR | counts as a **worked** day — rostered, resting near home base, not one of the 7 days off | rest day |

**When to schedule an RR:** when the pilot's 168-hour cycle is running out.
FDT Monitor already computes this (`ftlLimits.js` `recoveryRest*`, warning at
132 h = 36 h of headroom left); the planner reads the same figures
(`weeklyPlanAvailability.js`), so a pilot who needs an RR can never quietly
appear on next week's plan.

**And exactly one pair per rotation, against the break:** the 21/7 cycle puts an
RR pair immediately before the 7-day OFF block, and nowhere else.

> *"roster RR RR สองวันที่ติด กับ พัก 7 วัน ต้อง ติดกันแบบนั้น เลย ที่เหลือ จัด
> ตามเงื่อนไข เลย"* — Capt. Weera

So the generated pattern is **O×19, RR×2, X×7** — 28 days, of which 21 are
duty-related (19 `O` + 2 `RR`) and 7 are off
(`src/services/rosterTemplate.js`).

**The template does not place mid-rotation Recovery Rest at all.** That is what
*"ที่เหลือ จัดตามเงื่อนไข"* means: any further RR is scheduled **by condition**,
from the pilot's real rolling figures, not on a fixed day count. A template runs
before a single hour has been flown, so it cannot know when the 168-hour cycle
will actually run out — and writing rest days the pilot may not need is as wrong
as omitting ones they do.

> Earlier versions of the generator sprinkled RR pairs mid-rotation on a fixed
> count (`…O×6, RR×2, O×6, RR×2…`). Removed on instruction: it was guessing at
> a figure FDT Monitor computes properly.

### Which rest days may be moved

Rest days are not all equally fixed, and treating them as if they were made
the planner refuse legitimate adjustments:

| Roster code | May the weekly plan use that day for duty? |
|---|---|
| **VL / SL** (leave) | **Never** — red |
| **RR immediately before the OFF block** | **No** — red. That rest exists to be taken *right there*, before the pilot goes off; moving it defeats its purpose |
| **RR / R mid-rotation** | **Yes** — yellow caution. It is held to keep the pilot inside the 168-hour cycle, so it may be moved *provided the cycle still works out* |
| **X** (plain day off) | No — part of the 7 off days |

The distinction is made by looking forward from the rest day: if the unbroken
run of non-working days starting there is long enough to be the cycle's OFF
block, the rest is locked; otherwise it is mid-rotation and movable
(`weeklyPlanRestDays.js`).

When a movable rest is planned over, the caution says so explicitly and points
at the thing that now has to be re-checked — the 168-hour projection.

## Rule 2 — 12 hours minimum rest

Between the **end** of one duty and the **report time** of the next.

This one rule produces the behaviour that matters most in practice:

- Night ends 05:30 → earliest next report is **17:30**.
- So **night → night is legal** (exactly 12 h), and a pilot can do that
  night after night.
- But **night → day crew next morning is not** — Crew 1 reports 05:30 (for a
  06:30 departure), which is *before* the pilot has even come off the night.
- It also catches day → night on the *same* date: a day crew ends 17:30 and
  night reports 17:30, which is zero rest.

The rest calculation reaches back into the previous day, so planning several
weeks in one pass gives a legal joined-up sequence. Planning one week at a
time would restart from a blank slate at each week boundary.

## Rule 3 — Duty hours are the real constraint

**There is no maximum number of consecutive duty days, and no maximum number
of consecutive nights.** What stops you is the rolling duty total:

| Window | Limit |
|---|---|
| 7 days | 60 h |
| 14 days | 110 h |
| 28 days | 190 h |
| Single duty period | 12 h |

(Read from Settings → FTL Limits at run time; `weeklyPlanRules.js` only holds
the fallback.)

Night standby is 12 clock hours but **only 25 % counts as duty** = 3 h
(OPS-CM-01 7.9.2). A day crew books its whole window — 12 h for Crew 1,
reporting 05:30 for a 06:30 departure. That single difference explains the
whole shape of the roster:

- A pilot on nights accumulates 3 h/day → can sit night indefinitely.
- A pilot on day crews accumulates 9.5–12 h/day → runs out of the 60 h weekly
  allowance after **five** Crew-1 duties (6 × 12 h = 72 h).

**If a night standby is called out**, the FDP actually flown is added on top
of the 3 h. Planning can't know that ahead of time, so the plan books 3 h and
the real figure arrives later from Daily Duty. The planner also reads hours
**already flown** and continues from there, so a pilot who has had a heavy
month of callouts can't then be planned into a breach.

> **This rule was missing from the first version of the planner.** A plan for
> 20 Jul – 9 Aug 2026 reported "0 conflicts" while putting nine of eighteen
> pilots over 60 h/7 days — KTO reached 76.5 h. Rest and currency were being
> checked; hours were not. Fixed; the same three weeks now plan 186 seats
> instead of 204, with every pilot inside every limit. The 18 missing seats
> are real: the roster doesn't have the duty headroom to man five crews every
> single day.

## Rule 3b — Everything FDT Monitor shows, the planner obeys

The Weekly Schedule does not keep its own opinion of a pilot's standing. It
reads the **same rows FDT Monitor displays** (`loadAllPilotStatusRows`), so a
pilot who is red on that page can never quietly appear on next week's plan.

Blocked from being planned (`exc`):

| Source | Blocks when |
|---|---|
| Duty Time 7 / 14 / 28 days | at or over max |
| **Flight Time 7 / 28 / 365 days** | at or over max |
| **168-hour Recovery Rest cycle** | Recovery Rest due — needs rest, not another duty |

Reported but allowed (`warn`): approaching any of the above.

**Flight Time 90 days is a minimum, not a ceiling** (oil & gas recency). Being
under it is a currency caution and must *never* block planning — more flying
is the cure, so blocking would make it impossible to recover.

Every breach is named with the actual figure, e.g.
*"WJU: Flight Time 7 days at 34:30 of 34:00 — not fit to be planned for
duty."* A bare "check FDT Monitor" tells the planner nothing about which
limit or by how much.

## Rule 3c — Plan to the warning line, and look ahead the full window

Two things make a long plan honest rather than merely legal on day one:

**1. Check as of every planned date, not just today.** A pilot's standing on
FDT Monitor is a snapshot. By day 25 of a 30-day plan the rolling windows
have moved — a 28-day window ending on day 25 is three days of history and
twenty-five days of plan. So every window is recomputed for each date,
looking back the full 7 / 14 / 28 / 365 days from *that* date over recorded
history plus everything already planned.

Duty time projects exactly (the plan knows each assignment books 9.5–12 h for
a day crew, 3 h for a night). Flight time can't be projected — the plan doesn't know what will be
flown — so it's checked against recorded history as of each date, which
still matters: a pilot blocked on FT today may be clear by day 20 as old
flights roll out of the window.

**2. Aim below the warning figure, not the maximum.** A pilot sitting on
yellow has no room left for the callouts, weather and extensions that
actually happen. The planner therefore:

- hands each seat to whoever is carrying the **least** duty over the last
  7 and 28 days, so work spreads instead of piling onto the same few names;
- refuses any assignment that would reach the warning figure — strictly
  below, since the monitors turn yellow *at* it, not past it;
- and when a seat can only be filled by crossing that line, **leaves it
  unmanned and says so**, rather than quietly overloading someone.

> An unmanned crew line is a visible planning decision someone can act on. A
> pilot quietly on yellow for three weeks is a fatigue problem nobody
> notices until something goes wrong.

Measured over 20 Jul – 9 Aug 2026 on the real roster: **171 seats, zero red,
zero yellow, zero conflicts** — at the cost of leaving Crew 5 (and Crew 4 on
some days) unmanned. That is the roster's true capacity: about ten pilots on
duty a day cannot sustain five crews *and* keep everybody out of the yellow.

## Rule 4 — Night lines need night currency

Both pilots. Taken from the Training tab's **Night Currency** item —
`Night (90D)` in the imported workbook, which is the same thing the ops
paperwork calls **Night Recurrent**; confirmed by Capt. Weera, there is only
one night item, not two. Current = a recorded due date still in the future.

**No date recorded counts as NOT current.** An unknown is treated as expired,
because the cost of being wrong is a non-current crew on a night sector.

**An expired night currency does not ground the pilot.** They keep flying day
crews as normal and simply wait for night re-training; only the night line is
closed to them. That's why this is a separate rule from Rule 5 (overdue
training, which does stop a pilot flying), and why the Training module caps
this item at yellow and never red.

## Rule 5 — Documents and training must be valid

Read from **Training Monitor**. Any monitored item past its due date and the
pilot isn't planned to fly at all — that covers documents as well as courses:
passport, Thai licence, medical, LPC, OPC2, line check, flight training, CRM,
HUET, first aid, fire fighting, ESE, ground, DGs, CAC, ICAO English, SMS,
AVSEC, PBN, EGPWS & TCAS, and the rest.

Which items count is whatever is switched on under **Training Setting →
Monitor**, so turning an item off there also removes it from this rule — one
switch, both pages.

Night Currency is excluded from this test — Rule 4 handles it, and it doesn't
affect day flying.

### Rule 5b — Training is scheduled on the roster, and it is duty

Training Monitor says **when a thing is due**. It does not say **when the
pilot is at it**. Those days are put on the **roster**, with the roster's own
codes — Capt. Weera: *"พวกจัดการ training ต่างๆ หรือไปฝึกบิน sim จะจัดไว้ที่หน้า
roster"* — and the planner reads them from there.

| Roster code | Meaning | Counted as |
|---|---|---|
| `NT` | Night Training | **17:00–22:00** (from the roster legend) |
| `S` | Simulator | **08:00–16:00 (8 h)** — a sim duty period runs to about eight hours, not a full working day |
| `T` `C` `S/T` `CR` `AVS` `H` `FIRE` `FIRST` `SMS` | training, checks, sim travel | **08:00–17:00** |
| `INS` | Helideck inspection | 08:00–17:00 |

Three consequences, none of which existed before:

1. The pilot is **not available for a line** that day — including when the
   cell is a combo like `O,S`.
2. Those hours **count against the rolling 7 / 14 / 28-day duty totals**.
3. The **12-hour rest rule applies to them**. This is the one that was
   actually wrong: Night Training ends 22:00, Crew 1 reports 05:30, which is
   seven and a half hours. The planner would happily have done it, because a
   training day carried no hours and no end time at all — it looked like an
   empty day.

`S` is the **simulator session** itself. `S/T` is the **travel day — both the
outbound and the journey home** (Capt. Weera: *"S/T = คือการเดินทางไป sim หรือ
กลับจากซิม"*). Both are counted as a full duty day, 08:00–17:00, confirmed
rather than assumed. Positioning is duty, and a travel day that ends late is
exactly the case where the 12-hour rest before the next flying day matters.

The board's **Training** and **Night Training** rows are now filled in
**from the roster**, not by hand. If more pilots are at training than the row
has lines, the overflow is reported in the notes rather than silently dropped.

### Rule 5d — Training to book

Training Monitor turns an item red on the day it expires, which is the day the
pilot is already grounded. The board answers the earlier question: **who is due
soon and has no slot booked?**

Two sources crossed:

- **Due date** — the pilot's training record (Training Monitor)
- **Booked date** — a roster code between today and the due date: `S` `C` for
  LPC/OPC, `H` for HUET, `CR` for CRM, `T` for line/ground training, and so on

A slot only counts if it falls **before** the due date; one booked the week
after keeps nobody legal.

Listed while the item sits inside **its own caution window** — the number
already set in Training Setting, so the two pages can never disagree about how
much warning an item needs.

Only items that are actually taken as a day at work are listed. Passport,
medical and licence renewals appear on Training Monitor but nobody rosters a
day for them, and listing them as "not booked" would teach people to ignore
the panel.

> **Flight Recency (90D) was removed from Training Setting and Training
> Status** at Capt. Weera's instruction. Recency is a rolling count FDT
> Monitor computes from recorded flights; carrying it as a due date as well
> meant two pages could disagree about the same pilot.

**Course times.** Each item also carries how long it takes — days and hours,
entered in Training Setting. That is what turns "book HUET" into "keep two
days free". No built-in defaults: these are the company's own course lengths,
and a plausible-looking guess on a planning screen is worse than a blank.
Maximum two pilots away on a course at a time (Capt. Weera), which is what the
Training row's two lines are for.

**A suggested date, and a Book button.** For each unbooked item the board
proposes the earliest run of consecutive days where the pilot is already
rostered on duty, at least a week out and before the due date. Nothing is
written until **Book on roster** is pressed — the suggestion is a proposal,
the press is the decision.

> **This near-term board stays suggest-only. Long-range planning does not.**
> Capt. Weera later asked for training to be laid onto the roster *months*
> ahead, automatically: *"ส่วนการฝึกอบรมต่างๆ ก้อ วางแผน ลง ใน roster ได้เลย
> ตาม training monitor ก่อนที่จะครบ due … จัดไปก่อนได้เลยยาวๆๆ เป็นการวางแผน"*,
> and on whether to ask first: *"เขียน ลง อัตโนมัติ และ เจ้าหน้าที่เข้าไป
> แก้ไขได้"*. That is a different job from this one and lives in
> `src/services/rosterTrainingPlanner.js` — see **Rule 5e**. The distinction
> is deliberate: this board is deciding next week's crewing and wants a human
> in the loop; the planner is filling a year of roster nobody wants to type by
> hand. Both write the same merged codes, and every cell stays editable.

Booking writes the item's roster code (`S`, `H`, `CR`, …) onto those dates,
**keeping whatever was already there**: an `O` becomes `O,S`, never plain `S`.
The `O` is what counts the day toward the 21 working days of the cycle, and
that is what the pilot is paid on — overwriting it would quietly change
someone's pay to fix a training slot.

Because the booking lands on the roster as an ordinary code, everything
downstream picks it up with no further wiring: the pilot is no longer
available for a line that day (Rule 5b), the hours count, the 12-hour rest
applies, the board's Training row fills in, and the item drops off this list.

### Night Training — flown together, with a Captain, 17:30–22:30

> *"การจัด Night training ควร จัด นักบินด้วยกัน อย่างน้อย 2-3 คน ในนั้น ต้องเป็น
> กัปตัน หนึ่งท่านครับ"* — Capt. Weera

**Two people minimum, two or three normally, and one of them a Captain.** Night
training is a detail flown together, not a thing one pilot does alone.

Both halves are **warnings, not violations**, and deliberately so: these cells
are copied onto the board from whoever the roster marks `NT`, so a lone pilot
means the *roster* needs another `NT` day added. Blocking the plan would not fix
the roster. The Captain rule stays quiet while any pilot's rank is still
unrecorded, rather than reading an unknown as "no Captain".

**Night currency is NOT required for night training** — night training is how a
pilot regains it. `NIGHT_REQUIRES_CURRENCY` applies to the night *standby* line,
which is revenue flying.

**The window is 17:30–22:30**, so the 12-hour minimum rest runs to **10:30** the
next morning:

> *"โดยปกติ night training จะ ฝึกช่วงเวลา 17:30-22:30 กลับมา ต้อง พัก 12 ชั่วโมง
> ถึงจะถูกจัดบินได้ หรือ จัดฝึกอบรมต่างๆๆ"*

Those 12 hours bar **the next flight and the next course alike** — not just
flying. Both the checker and the long-range training planner (Rule 5e) measure
it, so the planner will not book a course on the morning after an `NT` day; it
reports the item as unplaceable instead.

**The simulator gives night training in the same visit.**

> *"night training สามารถ ไปฝึก ใน sim คราวเดียวกัน ได้เลยครับ … เราสมมุติ
> สถานการณ์ เป็นบินกลางคืนได้ ครับ ถึงแม้จะฝึกอบรม ช่วงเวลา กลางวัน หรือกลางคืน"*
> — Capt. Weera

The sim can **simulate** night whatever the clock says, so night training happens
*inside* the sim session — it is not a second detail flown that evening. The
roster cell is therefore normally just **`S`**: *"เข้า sim ครั้งเดียว ได้ night
ด้วยเลย ใส่แค่ S"*. `S` satisfies the night-currency item on its own, so a pilot
who has a sim booked before their night currency falls due is **not** given a
redundant `NT` detail as well.

> An earlier version of this document explained `S,NT` as "sim in the daytime,
> night training in the evening" — two sessions. That was wrong. It is one
> session that includes simulated night.

`S,NT` is still accepted rather than flagged as a clash: someone writing both is
describing one session, and it is also how a **late sim slot** gets recorded,
since the slot time is not fixed (*"อาจเป็นช่วงเย็นก็ได้ ขึ้นกับตาราง sim"*).
Such a cell spans 08:00–22:30 for planning purposes.

**Duty hours for a sim day come from the real entry, not from these windows.**

> *"การนับ DUTY ลงเวลา เหมือน FDT ปกติ ครับ ตามตาราง sim"* — Capt. Weera

A sim day's duty is entered in Daily Duty from the **actual sim schedule**, exactly
like any other duty, and FDT Monitor counts that. The windows in `rosterCodes.js`
are planning assumptions only — a figure for a day that has not happened yet, so
the rest and conflict checks have something to work with. Where a real entry
exists, it is the authority.

**Night currency comes from two places — the sim and the real aircraft.**

> *"simulator 6 เดือน ไป ที หนึ่ง ก้อจะได้ night training ด้วย และอีก ใกล้ 3 เดือน
> หลังจากไปsim มา ก็ วางแผนฝึก ไนท์ กับเครื่องจริง … สรุป ไนท์ ได้จาก ที่ sim และ
> เครื่ิองจริง"* — Capt. Weera

The sim visit is roughly **six-monthly**, and night training is done as part of
it. Roughly **three months after** returning from the sim, night training is
flown again **on the real aircraft** — so the two sources alternate and night
currency is renewed about every three months rather than only twice a year.

That is why night currency's caution window is 30 days while the sim items sit
at 90: it comes round far more often than a licence check does. Both sources
renew the same `night` item, and the planner treats either as satisfying it.

**Booked as a group, never one pilot alone.**

> *"NT กับเครื่องจริง book ยัง book อยู่คนเดี่ยว ต้อง book เป็นอย่างน้อย 2 คน ใน
> วันเดียวกัน และต้องเป็นกัปตัน 1 คน"* — Capt. Weera

The long-range planner (Rule 5e) does not book a night detail for one pilot and
leave the checker to complain afterwards. It finds a date where a **second pilot
is genuinely free**, with a **Captain among the two**, and writes both seats at
once. If no such date exists in the window it reports the item as unplaceable —
naming whether the shortage is a free day or a free Captain — rather than
writing a lone booking that is not a usable plan.

Two pilots who both need night currency are put on **one shared detail**, not
two: the Captain flying as the partner has his own currency renewed by the same
night. Without rank data the planner refuses to book night training at all,
since the Captain rule could not otherwise be honoured.

### Rule 5e — Long-range training planning, written automatically

Rule 5d catches what is due *soon*. This rule fills the roster *far ahead*, so
a year of courses is laid out before anyone has to think about it.

> *"ส่วนการฝึกอบรมต่างๆ ก้อ วางแผน ลง ใน roster ได้เลย ตาม training monitor
> ก่อนที่จะครบ due ยกตัวอย่าง simulator สามารถจัดล่วงหน้า ได้ 1-3 เดือนก่อน ครบ
> due ส่วน หลักสุตร อื่น ก้อ 1-2 เดือน จัดไปก่อนได้เลยยาวๆๆ เป็นการวางแผน"*
> — Capt. Weera

**How far ahead each item is placed.** A window, not a single date, taken from
those figures:

| Item | Placed between … and … before the due date |
|---|---|
| Simulator items — LPC, OPC, PBN, EGPWS/TCAS | **90 and 30 days** (1–3 months) |
| Every other rostered course — HUET, CRM, FIRE, FIRST, SMS, AVSEC, Line Check | **60 and 30 days** (1–2 months) |

> **`T` (Flight Training) was retired** — *"ส่วน code T เอาออก เลย ไม่ค่อยได้ใช้
> แล้ว"*. Four items used to be booked with it: **Flight Training, ESE, Ground
> and Dangerous Goods**. Rather than re-point them at some other code and book
> pilots onto the wrong kind of day, they are **no longer planned onto the
> roster at all** (*"เลิกวางแผนหลักสูตรเหล่านี้ไปเลย"*). They still carry due
> dates on Training Monitor; they are simply scheduled by hand if they come up.
> Line Check keeps `C`, which is what it always really was. A `T` already on an
> imported roster is still read as a training day, so old months keep their rest
> protection — it is just never written again.

The *maximum* stops a course being flown so early it wastes the validity it
renews. The *minimum* of 30 days stops the planner claiming a slot so late
there is no room to re-book if it falls through — those late ones are Rule 5d's
job, and it has a human in the loop. Simulator items get the wider window
because sim slots are booked against a third party's calendar and rarely land
on the first date asked for. The **earliest** qualifying run of days is taken,
not the latest, for the same reason.

**The simulator is placed first, ahead of everything else.**

> *"ส่วน SIM ให้ ความสำคัญ อันดับ แรกๆๆ เลย ห้าม book ทับ"* — Capt. Weera

Ordering by due date alone was not enough. A sim visit needs **five consecutive**
duty days and depends on someone else's calendar; a one-day course like AVSEC
fits almost anywhere. Whenever an AVSEC happened to fall due sooner it took a day
out of the middle of the only free week, and the sim was then reported
unplaceable — backwards, because the flexible course is the one that should move.

So **every simulator item is placed before any other course is considered**, and
each booking claims its dates as it goes, so the one-day courses flow *around*
the sim block instead of into it. A sim block already on the roster is never
written over either: the planner only ever targets a plain `O` day, and a day
already showing `S` is not one.

Within the same tier, the sooner-expiring item still goes first.

**Two hard rules on where it may write**, both from Capt. Weera:

1. **Only on a plain duty day** — *"เขียนในช่วง 19 ทำงาน"*. Training happens on
   company time.
2. **Never on top of RR** — *"แต่ไม่ทับ กับ RR"*. And by the same reasoning
   never on `R`, `X`, `VL` or `SL`: `RR` and `R` are there to satisfy the
   168-hour cycle and the minimum-rest rule, so writing a course over one would
   silently break an FDT protection that still *looks* satisfied on the
   calendar. `X` and leave are the pilot's own days.

Both are enforced through the single existing definition of "on duty" in
`rosterCodes.js` (`rosterDayInfo().onDuty`) rather than a second list kept in
the planner — one copy of a safety rule, so the two cannot drift apart.

**What it writes.** The item's roster code on its own — `S`, `H`, `CR` — in
place of the `O`. Deliberately **not** the comma form `O,S`, because that form
means something else:

> *"os คือ จัด ฝึก sim ช่วงวันพัก เลย ได้ ค่าทำงาน ล่วงเวลา ถือเป็นทำงานวันหยุด
> เลยใส่ O/S ครับ ขึ้นอยู่กับเราจัด ครับ"* — Capt. Weera

`O,S` marks a course placed on a pilot's **day off**, which earns **overtime**.
That is a decision the chief pilot makes case by case ("ขึ้นอยู่กับเราจัด"), and
this planner never places anything on a day off at all — so writing `O,S` would
both claim overtime for an ordinary working day and imply a decision nobody
made. The day was already an `O`, so nothing is lost from the 21 working days
by replacing it.

**How long a simulator visit takes.** The sim is at **Subang, Malaysia**, so the
figures already include travel either side of the details:

> *"SIM (LPC =5 วัน OPC=4 วัน) at Malaysia subang"* — Capt. Weera

| Item | Days |
|---|---|
| LPC | **5** |
| OPC | **4** |

These are defaults; a figure entered in Training Setting always wins over them.
They are also the only built-in course lengths in the app — everything else stays
blank until the company states it, because a plausible guess on a planning screen
is worse than a visible blank.

**A sim detail is an instructor plus two pilots.**

> *"TBO and PDA role TRI/TRE SIMulator, YLU role TRI Simulator … การมา sim ต้อง
> TRI sim มาด้วย กับ นักบิน อีกสองท่าน (ครูซิม นักบิน 2 ท่าน)"* — Capt. Weera

The whole party travels to Subang together: **one TRI/TRE sim instructor and two
pilots**. The planner writes all three onto the same dates, or reports that it
could not — it does **not** book a lone pilot onto a trip nobody could fly, which
is what it did before (and which quietly consumed the only free week in the
process).

Who counts as an instructor is **not** a list kept in the planner. It is read from
the **TRI/TRE hours already on each pilot's Pilot Experience record**, through the
same `isInstructorFromSpecialty()` the Weekly Schedule's pairing directives use —
so there is no second list to maintain and the two can never disagree. TBO and PDA
hold TRI/TRE; YLU holds TRI.

Two pilots who both need the same sim item are put on **one shared trip** rather
than two visits. Without rank/instructor data the sim is reported rather than
booked, since the rule could not otherwise be honoured.

**When it can't place something it says so.** If there is no run of free duty
days inside the window, the item is reported as skipped, with the window it
looked in and why every day in it was unusable. It does **not** shuffle rest
days or widen the window to make it fit. A training day invented on top of a
rest day would look compliant on the roster and be illegal in the air.

**It is written without asking, and it is editable afterwards** — *"เขียน ลง
อัตโนมัติ และ เจ้าหน้าที่เข้าไปแก้ไขได้"*. An item that already has a
satisfying code on the roster before its due date is left completely alone,
whether a human typed it or an earlier run wrote it, so re-running the planner
never double-books.

**On screen.** Pilot Roster → **Plan Training**. Pick how far ahead to plan
(12 / 18 / 24 months) and press **Plan and write to roster**. That is the whole
interaction: it plans and writes in one press, with **no preview and no confirm
dialog** — *"ใส่เลยครับ ไม่ต้อง preview"*.

> An earlier version of this panel worked out the plan, showed it, and waited
> for a second press to write. Removed on instruction.

What makes one press safe here is the planner's own restraint rather than a
dialog: it only ever targets a plain duty day, so nothing it writes can
overwrite a Recovery Rest, a rest day, a day off, leave, or training somebody
already entered. The worst case is a course landing on a working day the chief
pilot would rather have spent differently — and every cell stays editable by
hand, exactly as before.

The **"Could not fit"** list is shown as prominently as the successes, and the
panel deliberately stays open afterwards so it doesn't disappear at the moment
it becomes actionable: an item there is heading for its due date with nowhere to
go, and only a human can decide whether to free up a duty day, spend a day off
on it as overtime (`O,S`), or book it outside the window.

Lives in `src/services/rosterTrainingPlanner.js`, with the screen in
`src/modules/pilotRoster/PlanTrainingPanel.jsx`.

### Combo roster cells are read part by part

`O,N` is a compensate day that **can** take a night line; `O,X` is a
compensate day **off**; `O,S` is **training taken on a day off, earning
overtime** — *"จัด ฝึก sim ช่วงวันพัก เลย ได้ ค่าทำงาน ล่วงเวลา ถือเป็นทำงาน
วันหยุด เลยใส่ O/S … ขึ้นอยู่กับเราจัด"*. Before this, every comma cell was
classified "compensate" and skipped wholesale, which quietly removed those
pilots from the plan.

Because `O,S` carries a pay consequence, it is only ever entered by a human
deciding to use someone's day off. Nothing in the app writes it automatically
(see Rule 5e).

**But two COURSES on one day is a clash, not a compensate day.**

> *"จัด ไป sim แลัว ยังมี อบรม AVS มันทำไม่ได้ครับ … สรุป อย่ามี อบรม หลายอัน
> ในเวลาเดียวกัน ยกเว้น NT กับ SIM ทำได้"* — Capt. Weera

A cell like `S,AVS` — simulator *and* AVSEC on the same date — cannot be flown.
Every comma cell used to be classified `compensate`, a calm teal "something
changed here" marker, so nothing on the roster said the day was impossible. Such
a cell is now its own category, **`conflict`**, and is the one thing on this grid
drawn with a red fill: everything else is deliberately unfilled to keep the sheet
readable, but a day that cannot happen must be impossible to scroll past.

| Cell | Reading |
|---|---|
| `S,NT` / `NT,S` | **Allowed** — the one legitimate two-course day. Sim runs 08:00–16:00 and night training 17:30–22:30, so they don't overlap (*"ยกเว้น NT กับ SIM ทำได้"*). The cell spans 08:00–22:30. |
| `O,S` | Allowed — one course, taken on a day off, earning overtime |
| `O,X` | Allowed — compensate day off |
| `O,AVS`, `O,NT` | Allowed — one course on a duty day |
| `S,AVS`, `AVS,H`, `S,C`, `NT,AVS`, `S,INS`, `O,S,AVS` | **Clash** — two courses (or a course and an inspection) on one day |

The long-range planner cannot create one of these: it writes a plain code onto a
plain `O` day and never onto a day that already carries a course. A clash on the
roster therefore came from an Excel import or from hand entry, which is exactly
what the red cell is for.

### Rule 5c — Fewer day crews at the weekend

The customers fly less on Saturday and Sunday (Capt. Weera: *"เสาร์-อาทิตย์
ลูกค้าบินน้อยลง"*), so those days open **four day crews, not six** — Crew 1–4,
keeping the departure ladder intact.

**Night Standby runs every day, weekend included.** It isn't the customer's
flying programme, it's cover.

This is not cosmetic. Opening all six lines seven days a week spent roughly
twenty crew-days a month on flying nobody asked for, and every one of those
days was charged against a pilot's rolling 7 / 14 / 28-day totals — hours that
then weren't there on the days the work actually was.

Set per weekday in `DAY_CREWS_BY_WEEKDAY` (weeklyPlanRules.js), and
overridable per run, so a one-off busy Saturday can be planned without editing
the rules.

## Rule 6 — Crew composition

Two Co-pilots may never crew together. Captain + Captain is legal but
wasteful, since every crew needs a Captain: burning two on one line leaves
later crews unmannable. So the **second seat prefers a Co-pilot**.

> This one also came from watching the output. The first version allowed
> Captain + Captain freely, ran out of Captains after Crew 2, and left
> Crews 3–5 empty every day — 118 seats filled instead of 204.

## Rule 6a — No more than six nights per cycle

Maximum **6 night duties per 28-day cycle**, counted across runs (the last
cycle's planned nights are loaded before planning the next one, so re-running
the planner doesn't reset the count).

This rule exists because **nothing else pushes back on night work.** Night
standby books only 3 h of duty (25 % of 12), so it is cheap against every FTL
limit — an unconstrained planner will happily park the same night-current
pilot on the night line over and over and every number will still look fine.

> That is exactly what the first plan did: **CSU drew 11 of the 21 nights**,
> five in the first week and six in the second, entirely legally. With the cap
> and a "fewest nights first" preference, the same three weeks spread the
> night line across **18 pilots, nobody above 5**.

Night work is disruptive in a way duty hours don't measure, and the pool of
night-current pilots is small — so it has to be shared deliberately.

The cap limits NIGHT work, it doesn't stand a pilot down: someone who has
used their six nights is still available for day crews.

## Rule 6b — Rotation pattern and flight-hour fairness

**Rotation:** Night → OFF → Crew 1 → Crew 3 → Crew 2 → Crew 4 → back to Night.

OFF sits straight after Night on purpose: coming off at 05:30 the pilot can't
take a day crew the next morning anyway (Rule 2), so the day out is where the
rest already has to be. The day lines then alternate **1-3-2-4** rather than
running 1-2-3-4, which spreads the early 05:30 reports around instead of
walking one pilot down the report times day after day.

A day a pilot isn't used counts as their OFF step, so they come back round to
Crew 1 next rather than being stuck waiting for the line they missed.

**Flight-hour fairness:** nobody should finish a 21/7 cycle badly under-flown.
Target is **40 flight hours per 28-day cycle** (21 duty days + 7 off). Pilots
below it are preferred when filling a seat, and anyone still short at the end
of the planning horizon is listed as **Under-flown**.

Both of these are **preferences, not constraints**. They only reorder the
pilots who are already legal for a seat — neither can put someone on a line
that rest, currency, training, pairing or the duty ceiling has refused. And
being under-flown is never a reason to withhold flying: that would make the
problem worse, not better.

> This is the one check on the page that looks for *too little* rather than
> too much. A pilot consistently passed over for the flying loses currency and
> skill, and it is completely invisible on a page that only hunts for limits
> being exceeded.

Verified over 20 Jul – 9 Aug 2026 on the real roster: the rotation comes out
as e.g. `CSU: Night → off → Crew 1 → Crew 3 → Crew 2 → off → off → Crew 3 →
Crew 2 → Night → off → Crew 1 → Crew 4`, still with zero red and zero yellow.

## Rule 6d — First and last day of a tour

The two ends of a tour are not like the days in the middle.

**First day back** — the pilot has been out of Area Operations for seven days.

- **Never night standby.** A night callout is the worst possible way to walk
  back in after a week away. Hard rule, not a preference.
- **Crewed with someone currently operating** — not with another pilot who
  has also just returned. Two people who have both been away for a week is
  not a crew, it's two passengers.

**Last day** — the pilot travels home that evening. Pilots normally book the
flight home for about **20:00 on the last day**, before the RR RR days.

- Give them an **early-finishing line** — the earliest report, which finishes
  earliest. A late finish costs them the ticket.
- **Night on the last day is allowed**: they come off at 05:30 on the first
  RR day and the OFF block is still intact. But it changes their travel
  plans, so the plan **says so explicitly** and the pilot must be told in
  advance — some are booking flights to another province.

> *"2026-07-23: NKR is on night standby on the LAST DAY of their tour — tell
> them in advance, they normally fly home about 20:00 that evening."*

Both days are worked out from the roster: a working day whose previous day is
part of an OFF block is a first day; one whose next day starts an OFF block
is a last day. A single mid-rotation RR is not an OFF block, so the day after
it is *not* treated as a first day back (`weeklyPlanTourDays.js`).

Measured over the three weeks: 12 first-day assignments, **none on night**,
all on day crews; 7 last-day assignments, 3 on Crew 1, 2 on night — both
notified.

### Night before the RR days — three weeks' notice, and only if needed

Night on the **last day of a tour** stays allowed (they come off at 05:30 on
the first RR day and the OFF block is intact), but Capt. Weera set two
conditions on it: *"อย่างน้อย 3 week ถ้าไม่จำเป็น ก็ไม่ต้องเข้า night ก่อน RR"*.

1. **At least 21 days' notice**, counted from the day the plan is made — not
   from the start of the period being planned. Inside that window the planner
   simply won't do it: pilots buy their flights home well in advance, and
   telling someone a week out that they are working the evening they meant to
   travel is not notice, it is a problem handed over.
2. **Last resort only.** Every other legal pilot is tried first, *including*
   pilots who would go into the warning band. The last-day pilot is taken only
   when the alternative is leaving the night seat unmanned.

When it does happen the plan says so, with the number of days' notice in the
note, so the pilot can be told the same day the plan is published.

Tunable: `LAST_DAY_NIGHT_NOTICE_DAYS` (21) and `LAST_DAY_NIGHT_LAST_RESORT`.

## Rule 6c — Mix the crews (CRM)

Where there's a free choice, a pilot is put with someone they **haven't flown
with recently** rather than their usual partner. Lookback: one 28-day cycle,
carried across runs.

The reason is CRM, not fairness. Two pilots who always fly together settle
into shorthand and unspoken assumptions, and stop practising the explicit
briefing, challenge and cross-check that CRM depends on. Mixing keeps that
working, and spreads experience around the fleet instead of concentrating it
in fixed partnerships.

**It applies to the second seat only.** The Captain seat is still chosen by
the rotation pattern (Rule 6b); the variety is found in who sits beside them.

### Where it sits in the ordering — and why that mattered

First attempt put CRM *after* the rotation preference. Measured over the same
three weeks, it changed almost nothing:

| | distinct crew pairings | most-repeated pair | seats |
|---|---|---|---|
| CRM after rotation | 43 | flew together 5× | 166 |
| **CRM before rotation** | **67** | **2×** | 162 |

Rotation had already narrowed the field to a single candidate before CRM was
ever consulted, so the preference was effectively inert. Moving it ahead of
rotation — while keeping it limited to the second seat, so the Captain
rotation is untouched — is what actually produces mixed crews: **67 different
pairings over three weeks, nobody flying with the same partner more than
twice.**

The cost is four seats out of 166, and zero red / zero yellow either way.

## Rule 6e — Training pairings (entered, not coded)

“This pilot must fly with this instructor until this date.”

Line training, a return to line, post-OPC consolidation — these are temporary
instructions with an end date, not standing rules, so they are **entered as
data**: Weekly Schedule → **Training Pairings**.

| Pilot | Must fly with | From | Until | Reason |
|---|---|---|---|---|
| RPA | KPO | 20 Jul | 15 Aug | Line training |
| KTO | *(blank = any instructor)* | 1 Aug | 30 Sep | Post-OPC |

The planner enforces it while the dates are current and **stops on its own**
once the end date passes — nothing to remember to delete. A row past its end
date is greyed out and marked *expired* rather than removed, so the history
of what was required is still visible.

### Who counts as an instructor

**Any pilot holding TRI or TRE hours** on their Pilot Experience record
(Specialty Hours table). No new field, no separate list to maintain, and it
stays right automatically as people qualify.

If nobody has TRI/TRE hours recorded, the panel says so — otherwise “any
instructor” would silently match nobody and quietly strand the trainee.

### When it can't be met

The trainee is not planned that day, and the reason says exactly why:
*“RPA: must fly with KPO until 2026-08-15 — not available”*. It never
substitutes someone else and hopes nobody notices.

Stored in `app_settings` under `weekly_plan_training_pairs`, so it syncs to
every device like the FTL limits do, with no schema change.

## Rule 7 — Experience Level and pairing

**OPS-CM-01 7.17.4**, Issue 07, 29 Apr 2025. Implemented in
`src/utils/experienceLevel.js`.

A pilot's Level (1–4) comes from five experience factors, each scored 1–4
against a band table. **The Captain and Co-pilot tables are different** — the
same 2,500 hours total time scores 1 for a Captain and 3 for a Co-pilot.

| Factor | Captain bands (→1/2/3/4) | Co-pilot bands |
|---|---|---|
| Total Flight Time | ≤3000 / ≤4000 / ≤5000 / >5000 | ≤1000 / ≤2000 / ≤3000 / >3000 |
| PIC | ≤1500 / ≤2000 / ≤2500 / >2500 | ≤500 / ≤1000 / ≤1500 / >1500 |
| Type (AW139) | ≤400 / ≤800 / ≤1200 / >1200 | same |
| Offshore | ≤500 / ≤1000 / ≤2000 / >2000 | same |
| Multiengine | ≤1200 / ≤2500 / ≤3500 / >3500 | ≤600 / ≤900 / ≤1200 / >1200 |

The five scores are added; the sum gives the Level:

| Sum | 8–11 | 12–15 | 16–19 | 20 |
|---|---|---|---|---|
| **Level** | 1 | 2 | 3 | 4 |

### The pairing rule — 7.17.4(2)

> "The minimum experience levels when pairing both pilots for scheduling are
> not less than 4"

The two pilots' **Levels added** must be ≥ 4:

- L3 Captain + L1 Co-pilot = 4 ✓
- L2 Captain + L1 Co-pilot = 3 ✗
- L1 + L1 = 2 ✗

This is what keeps two low-time pilots off the same aircraft — a stricter
version of the older "never two Co-pilots together" rule, and it supersedes
it in practice.

The hours are read from each pilot's Pilot Experience record and are kept
current (baseline plus everything logged in Daily Duty since), so a level
rises on its own as a pilot builds time — nobody has to re-enter it.

### Which level the grid shows

The number in brackets after a code — `WJU(3)` — is the **computed** level,
the same one the pairing rule enforces. It is *not* the figure carried in
from the spreadsheet.

| Shown | Meaning |
|---|---|
| `WJU(3)` | computed from the Experience record |
| `WJU(4•)` | computed 4, but the imported sheet says something else — the sheet is out of date |
| `WJU(3?)` | Experience record too incomplete to compute; the imported figure is shown **unverified** |

> Originally the grid showed the imported figure while the pairing rule used
> the computed one. Two numbers, silently disagreeing, with the wrong one on
> screen — worse than showing no level at all, because people believe what
> the grid shows. Every mismatch is now marked in the cell *and* listed above
> the table so the stale source gets corrected.

**Incomplete records don't silently pass.** If a factor is missing, the pilot
has no computed Level, the auto-planner doesn't block on it, and the checks
report "Experience Level can't be worked out — check their Pilot Experience
record" as a warning. A missing figure is never treated as zero, which would
produce a plausible but wrong Level.

---

## Rule 8 — Suggesting OFF and training back to the roster

Every other rule above is the plan READING the roster and FDT/training
standing. This one is the plan PROPOSING something back to it — closing the
loop Capt. Weera described directly:

> "วัตถุประสงค์ ของ Roster แค่ เช็ค จำนวนนักบินต่อวัน ที่อยู่บิน (ทั้งกัปตันและ
> นักบินผู้ช่วย) ที่ไม่ติดฝึกอบรมต่างๆ เจ็บ ป่วย ลา weekly แค่ เอานักบินมาจัดบิน
> เป็นคู่ ๆ ตาม เงือนไข ที่ยัง valid ทุกเรือง fdt training due ถ้า ใกล้
> เงือนไข fdt กีจัด off ถ้าใกล้เงือนไขการฝึกอบรม ก็จัด booking วัน
> ฝึกอบรม ตามจำนวนวัน ชั่วโมง ใน roster ได้เลย เป็นการแนะนำ planning"

In short: the roster's only job is a daily headcount of who's actually free to
fly; the weekly plan pairs them up under FDT and training-due conditions that
must both still hold. When either condition is about to fail, the roster
should be told — as a rostered OFF, or a training booking — rather than the
gap only showing up as a blank seat on the weekly board.

**It only ever suggests.** Asked directly whether this should write straight
to the roster or only propose it, Capt. Weera settled on suggest-and-confirm:

> "เงื่อนไข crosscheck มี tick ให้ crosscheck กับ admin ทำเอง วางแผนเอง ใน
> การ booking ลง roster เอง และ เราแค่ แนะนำ"

So this follows the exact same shape `suggestTrainingSlot()` / "Book on
roster" already established for training on its own (see the "Training to
book" panel above) — **nothing is written to the roster on its own.** The
chief pilot reviews the list, ticks the ones he agrees with, and presses
"Book ticked" himself. An earlier version of this feature wrote immediately;
that was corrected once Capt. Weera clarified the crosscheck has to be his.

**When it runs.** Every time **"Re-plan This Week Only"** or **"Plan 30
Days"** is pressed (`handleAutoFill` in `WeeklySchedule.jsx`), after the plan
itself is built, a fresh list of suggestions replaces whatever was showing
before. Never on page load, and never for a manually-edited cell — only the
two auto-fill buttons compute the list.

**What suggests an FDT-caused OFF.** `autoFillWeek()` already refuses to give
a pilot a line when they're near a limit — it just used to leave that
silently as a blank seat. Every `unplaced` entry tagged `cause: "fdt-blocked"`
(currently blocked per FDT Monitor) or `cause: "fdt-limit"` (would breach a
rolling 7/14/28-day duty or flight ceiling that day) becomes a proposal to
write **"O,X"** onto their roster cell for that date — the same "Compensate
day off" combo a human already writes by hand, so it reads on the calendar
exactly like one would once booked. The **O is kept, not replaced** — same
reasoning as every other combo cell in this app (Rule "What each document
owns" above): the O is what counts the day toward the 21 working days of the
cycle. A day that's already off, on leave, resting or at training never
reaches this path at all, because those pilots never register as `onDuty` in
the first place — see Rule 1.

**What suggests a training booking.** The exact same rows Training Due /
"Training to book" already lists as due-soon-and-unbooked (`trainingToBook()`,
the company's own caution window from Training Setting — no new threshold is
invented). Each gets a proposed earliest legal slot (`suggestTrainingSlot()`,
the same proposal the manual "Book on roster" button already offers), using
the course length from `training_durations`. An item with no legal slot
before its due date is still listed, marked as unable to be booked, rather
than silently dropped — writing nothing is the honest answer when there
genuinely isn't room.

**Both use the thresholds already on screen.** Asked whether "near" should use
a new cutoff or the ones already configured, Capt. Weera confirmed:

> "ใช้เกณฑ์เดิมที่ตั้งไว้แล้ว"

— i.e. the same `ftl_limits` warn/max bands FDT Monitor shows, and the same
per-item `training_thresholds` Training Due already uses. Nothing here can
disagree with what those two pages already show, because it reads the same
numbers.

**Ticked by default.** Every suggestion starts ticked — they're already
screened against the same thresholds FDT Monitor / Training Due show, so the
normal flow is review-and-deselect, not hunt-and-tick. Pressing "Book ticked"
writes only the ticked ones via `importRosterMany`; anything left unticked is
simply dropped from the list on the next run.

**Told to the admin.** Once something is actually booked (not before), it's
logged (`roster_auto_writeback_log` setting, capped to the most recent 200)
and shown in a "Booked history" list on the same panel, so what was done
stays visible later, not just in the moment. Implemented in
`weeklyPlanWriteback.js` (the pure derive/describe logic, producing
suggestions only — unit-tested without a database) and wired into
`handleAutoFill()` / `confirmWriteback()` in `WeeklySchedule.jsx`.

**Booking a suggestion never disturbs an unsaved plan.** The current week's
plan is usually still staged (unsaved) when a suggestion is booked — booking
only reloads the roster, never the full page state, so it can never discard
edits sitting in "review, then press Save."

**A standing on/off tick, separate from the per-suggestion ticks.** Capt.
Weera asked for this as its own permanent control, not something that only
appears after a plan has already run:

> "ไม่เห็นมีช่องให้ติ๊กว่าจะ crosscheck ให้ หรือทำเองโดยแอดมิน ... อยากได้
> ปุ่ม/ช่องติ๊กแบบถาวร ไม่ใช่แบบที่โผล่หลังวางแผน"

**"Suggest roster changes"**, next to the two plan buttons, persisted via
`roster_writeback_enabled` (on by default). Ticked: Re-plan / Plan 30 Days
also computes suggestions, same as described above. Unticked: neither button
computes anything — the roster is left exactly as this feature never
existed, and the chief pilot crosschecks and books it entirely himself. Any
suggestions already on screen are cleared the moment it's unticked, so an
old proposal can't be booked after switching to "I'll do this myself."

---

## Settled — and deliberately not built

Questions that came up, were answered, and are recorded here so nobody
re-opens them or "helpfully" adds them later.

**Crew 1–5 are not tied to customers or aircraft.** They differ only by
scheduled departure (06:30 / 07:00 / 07:30 / 08:00 / 08:30 / 09:00). There is no
customer-to-crew or aircraft-to-crew mapping to honour, so the planner is
free to put anyone on any line. Confirmed by Capt. Weera: *"ข้อนี้ ยังไม่มี"*.

> The source spreadsheet has separate sheets named ConocoPhillips and AW139,
> which look like a per-customer split and are not one. Don't infer a rule
> from them.

**Crew pairing continuity** — resolved the other way: pairs are deliberately
**mixed**, not kept together, for CRM (Rule 6c).

**First / Last day of tour** — answered in full and implemented (Rule 6d):
first day never on night and crewed with someone currently operating; last
day gets an early finish, night allowed with advance notice.

**Line training pairing** — implemented as enterable data with an end date
(Rule 6e), not as code.

**Thai public holidays are ordinary flying days.** Songkran, New Year and the
rest make no difference to the offshore programme — only Saturday and Sunday
are lighter (Rule 5c). Confirmed by Capt. Weera, so no holiday calendar is
needed and none should be added.

**Weekend crews are Crew 1-4**, the four earliest departures, not a later
subset. Confirmed rather than inferred.

**The pairing level is ≥ 4 for night and day alike.** 7.17.4 gives one
combined-level rule and it applies everywhere — the night line does not need
a higher figure. Confirmed by Capt. Weera: *"night or day crews, experience
level >= 4"*. Already what the planner does; recorded so the single rule
isn't mistaken for an oversight.

---

## Nothing open

Every question raised while building this has been answered. If a new one
comes up, add it here with the answer and the reasoning — the point of this
document is that the next person (or the next model) doesn't have to
re-derive it from the code.
