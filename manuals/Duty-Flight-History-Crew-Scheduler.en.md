# Duty & Flight History — Crew Scheduler Manual

AviCore Admin / Crew v1.0.349 · 15 Nov 2026 · Capt. Weera Juntaklud

## What this tab is for

Duty & Flight History answers one question: **over the next 7 days, which pilots can still be given flying, and for how many hours** — based on what they have already flown and been on duty, the FTL limits, and the monthly roster.

- **Open it at:** AviCore Admin → Operations → **Pilot Roster** → 3rd tab **Duty & Flight History**
- **Data comes from:** recorded Daily Duty / FDT (flight and duty hours) and the Duty Schedule (monthly roster)
- **Calculation:** the same formulas as FDT Monitor, so the numbers match on every page
- **Read only:** nothing can be edited here — change Daily Duty or the Duty Schedule, then press **Refresh**

## The screen has 3 coloured parts

Each row is one pilot. Read left to right = past → future → totals.

| # | Part | Header colour | What it shows |
| --- | --- | --- | --- |
| 1 | Pilot | Dark grey | Pilot code and name |
| 2 | Past 28 days — FT / DT | Blue | What was flown and the duty done, day by day |
| 3 | Next 7 days — FT / DT / 168h + Remark | Green | Hours still left each day + RR/OFF/leave/Training from the roster |
| 4 | Rolling totals | Purple | Totals as of today against the limits |

Legend above the table: light blue = flight day · grey = non-flight duty · light green = within limits · yellow = near a limit · **red cell + red text** = over a limit, or roster OFF / VL / SL · **red text only** = the RR pair right before a 7-day OFF · purple tag **S/T** / **S** = a sim trip day · purple tag **Free · S/T −n** = a day before travelling to the sim that must stay free of duty

Below the table is the **Sim training — next 14 days** panel (see Sim training below). Click its header to collapse / expand.

## Row order: who is on top

Rows are grouped, with a dark group bar between them: **Captain** → **Co-pilot** (SFO / FO) → **Position not set** (no Position entered in Pilot Experience)

Inside a group, rows are sorted by the Next 7 days colours so the pilots who can fly the most are on top:

1. Most **green** cells first (days with enough hours where the roster does not give rest / off / leave — sim trip days and Free days before S/T do not count as green)
2. If equal, fewer **red cells** first (over a limit, OFF, VL, SL)
3. If still equal, more **FT** left tomorrow, then more **DT** left

## Reading Past days (blue)

One cell per day showing what the pilot did that day. Show the last 7, 14, 28 or 56 days (default 28).

| Cell | Meaning | Example |
| --- | --- | --- |
| Light blue, 2 lines | Flight day: top = **FT** (flight time), bottom = DT (duty time) | 3:20 / 9:45 |
| Grey + code | Non-flight duty with its DT | DSB / 2:30 |
| Empty | No duty recorded | — |

Non-flight duty codes: **DSB** Day Standby · **NSB** Night Standby · **POS** Positioning · **GT** Ground Training · **MTG** Meeting · **TRV** Travel · **OFF** Office · **GR** Ground Run · **OTH** Other

Standby DT counts at the credit % set in Settings (e.g. 25%), the same as FDT Monitor. Hover over any cell for the full details.

## Reading Next 7 days (green)

The part used for actual planning. Each day ahead has 3 lines showing **how much is still left** before a limit, if the pilot keeps working.

| Line | Meaning | How to use it |
| --- | --- | --- |
| 1 · **FT left** (bold) | Flight time still allowed that day — the tightest of 7D / 28D / 365D | To give 5:00 of flying, it must show more than 5:00 |
| 2 · **DT left** | Duty time still allowed — the tightest of 7D / 14D / 28D | Must be more than the whole duty day (including report before flight) |
| 3 · **168h cycle** | Hours left before a Recovery Rest must start, from the start of that day | Under 36h (yellow) = an RR is needed that day or the next |

### Cell colours

| Cell | Meaning | Can be given flying? |
| --- | --- | --- |
| Light green | Within all limits and the roster has the pilot working | Yes |
| Yellow | Near a limit (past the caution line, or 168h under 36h left) | Yes, with care |
| **Red cell + red text** | Over a limit / nothing left, or RR due | **No** |
| **Red cell + red text** | Roster **OFF** (X or O,X), **VL** or **SL** — the pilot is away | **No** |
| **Red text** (no red cell) | **The RR pair before a 7-day OFF** (21/7 pattern) | Should not — rostered rest |

Hover over a cell to see the reason, e.g. "Roster: OFF – not available" or "Roster: VL – on leave, not available".

### The 168h cycle line (OPS-CM-01 7.12.4)

Recovery Rest = at least **36 hours** of rest covering **2 local nights** (22:00–08:00) of at least **8 hours** each. The next Recovery Rest must start within **168 hours** of the end of the last one.

What the 168h line can show:

- **103h** — 103 hours left before a rest must start (under 36h turns yellow)
- **RR ✓** — a Recovery Rest that day: resting now by the duty records, or the roster gives 2 or more days off in a row
- **RR due** (red cell) — overdue: no duty may be given until a Recovery Rest is taken
- **no RR** (yellow) — no Recovery Rest found in the records; check that pilot's Daily Duty

How 168h is worked out:

1. **Past days use what was actually flown (Daily Duty / FDT):** rest runs from the end of duty + 30 min post-flight to the next report. 36h + 2 nights = a Recovery Rest
2. **Days ahead use the roster:** non-duty days — **RR, R, OFF (X), VL, SL** — **2 or more days** in a row count as a Recovery Rest, shown as **RR ✓**, and a new 168h cycle starts at 00:00 the day after
3. **One day off is not enough:** it is under 36h + 2 nights, so the current 168h cycle keeps running
4. **A past roster RR never overrides real duty:** if the roster had RR but the pilot actually flew, the recorded duty is used. If the two give different deadlines, the later one is used
5. SL / VL / OFF **do not count as duty**

**Example (KPO):** duty ended 10 Nov 10:22 (with post-flight), next report 12 Nov 07:30 = 45.1h rest covering the nights of 10 and 11 Nov (10.0 and 9.5h) → a Recovery Rest, so the next one must start before 19 Nov 07:30. The screen shows 15 Nov = 103h · 16 = 79h · 17 = 55h · 18 = 31h (yellow) · 19–20 = RR ✓ from the roster

### Column 8: Remark (roster)

Shows the non-working spells in the next 7 days with their full length. Months are 3 letters (Jan, Feb … Dec) and all items sit on one line separated by **,** so the row stays short.

| Tag | Meaning | Example |
| --- | --- | --- |
| Blue | RR / R — rest | RR 15–16 Nov (2d) |
| Grey | OFF — days off (X or O,X) | OFF 17–23 Nov (7d) |
| Orange | VL / SL — leave | VL 22–24 Nov (3d) |
| Purple | Training — S, S/T, CRM, G, DG, INS, ESE etc. | CRM 21 Nov |

Back-to-back spells (rest → off → leave) are shown as one chain with arrows and a total, e.g. **RR 19–20 Nov (2d) → OFF 21–27 Nov (7d) total 9d**. OFF can be shorter than 7 days if the pilot takes OT — the roster is shown as it is.

An empty Remark = the roster has the pilot working (O) all 7 days.

## Sim training — getting pilots ready for the sim

The **Sim training — next 14 days** panel below the table lists every pilot whose roster has an **S/T** in the next 14 days and checks whether they are ready. The app only checks and suggests — changing the roster is the crew scheduler's job.

### A sim trip on the roster

| Code | Meaning |
| --- | --- |
| **S/T** | Positioning to or from the sim |
| **S** | Sim training |

The trip starts at the **outbound S/T = day 1**, runs through all the S days and ends at the **return S/T**, as the roster has it — e.g. S/T S S S/T = 4 days or S/T S S S S/T = 5 days. It is not fixed.

### Conditions to meet on the S/T day

| Item | Condition | Why |
| --- | --- | --- |
| DT 7D | **≥ 60:00** left | A sim trip uses about 60h of DT 7D |
| FT 7D | **≥ 12:00** left | A sim trip uses about 12h of FT 7D |
| RR before S/T | The roster has **2 or more** days off in a row (RR / OFF / VL / SL) ending the day before S/T | So a new 168h cycle starts before travelling |

If a longer window (DT 14D / 28D, FT 28D / 365D) has less left than the trip needs, the app flags that too. Because the DT 7D limit is 60h, having 60h of DT 7D left on S/T means **no duty at all in the 7 days before travel**.

### Reading the panel

| Column | Meaning |
| --- | --- |
| Trip | The trip from the roster, e.g. S/T 16–19 Nov (4d) |
| DT 7D left on S/T | DT 7D left on the S/T day against 60:00 (red = not enough) |
| FT 7D left on S/T | FT 7D left on the S/T day against 12:00 |
| RR before S/T | ✓ with the rest, e.g. RR 14–15 Nov, or ✗ none (hover to see 168h left) |
| Status | **Ready** · **Check roster** (passes, but the roster has duty before travel) · **Not ready** |
| What to do | Hours short, first date DT/FT will be enough, roster duty days to move, days to put RR on |

### In Next 7 days

| Tag in a cell | Meaning |
| --- | --- |
| **Free · S/T −3** (purple border) | A working day in the 7 days before S/T — duty that day cuts the DT 7D the trip needs; keep it free |
| **S/T −2** | A rest day (RR/OFF) before S/T |
| **S/T** / **S** (purple cell) | A trip day, with its roster code |

These days do not count as green when sorting, so a pilot about to go to the sim sits lower and is not picked for flying first.

**Example (KTO):** S/T 27 Nov – 1 Dec (5d), DT 7D 60:00 passes, but **Not ready** because there is no RR before S/T and the roster has O/CRM in the 7 days before travel → put RR on 25–26 Nov and move that duty out.

## Reading Rolling totals (purple, far right)

Totals **as of today** against the limits. The numbers match FDT Monitor.

| Column | Limit (default) |
| --- | --- |
| FT 7D / 28D / 365D | 34 / 110 / 1000 h |
| DT 7D / 14D / 28D | 60 / 110 / 190 h |

Each cell reads like **22:00/34** = 22h used of 34, and the line below **12:00 left** = 12h left. Colours: light green = within limits · yellow = past the caution line · red = over the limit ("none left"). The real limits are those set in Settings → FTL Limits.

## Importing data so this page is right

This page is only as good as the data imported. There are 2 ways:

| Import | Where | What happens to old data |
| --- | --- | --- |
| **Roster** (yearly RR Excel) | Pilot Roster → Duty Schedule → **Import from Excel** | Deletes the old roster in the chosen range and loads it again exactly as the Excel |
| **FDT** (the pilot's _FDT.xlsx, e.g. KPO_FDT.xlsx) | Import FDT | Deletes that pilot's old Daily Duty and loads every entry from the file |

Both let you choose a range before importing:

- **All** — the whole file (FDT: deletes **all** of that pilot's Daily Duty first, including entries typed by hand)
- **Only from … to …** — deletes and reloads only the chosen dates; other days are not touched

After importing, the app shows how many entries were deleted and loaded. Come back here and press **Refresh**.

## Planning steps

Use these every time before sending the Weekly Schedule or crewing the next day:

1. Press **Refresh** for the latest Daily Duty and roster
2. Look at the day's column in **Next 7 days**. Take out pilots with a **red cell** (over a limit, OFF, VL, SL) or **red text** (RR before a 7-day OFF), and check the Training tags in Remark
3. Start from the top row of each group (Captain / Co-pilot) — the top pilot has the most green days. Pick **light green** cells first; yellow is usable with care
4. Compare **FT left** with the flying to be given, and **DT left** with the whole duty day — both must be more
5. Check the **Sim training** panel: pilots with an S/T in the next 14 days must be **Ready**. If not, follow What to do (RR before S/T, no duty in the 7 days before travel)
6. Check the **168h** line: if yellow (under 36h), the roster needs an RR that day or the next. If there is none, arrange an RR before giving more flying
7. Confirm with **Rolling totals**: pilots whose 28D or 365D is already yellow are better kept as standby
8. Save the plan in Weekly Schedule — the final decision always belongs to the admin and crew scheduler

**Example:** to give CSU 5:00 of flying on Friday, the Friday cell shows FT 6:30 / DT 22:00 / 52h in green and Remark is empty → can be crewed, but after the flight only 1:30 of FT 7D is left, so avoid a long flight on Saturday.

## On-screen tools

| Button / action | What it does |
| --- | --- |
| Search box | Type a pilot code or name, e.g. CSU |
| Show last | Show the last 7 / 14 / 28 / 56 days (fewer = narrower table, bigger text) |
| Refresh | Load the data again after changing Daily Duty or the roster |
| Print | Print the table |
| − / + | Zoom 50%–120% |
| **Fit** (default) | Shrink the table to the screen width so every part is visible |
| Full Screen | Show the table full screen |
| Drag | Hold the left mouse button on the table and drag in any direction |
| Hover over a cell | See that cell's full details |

If the text is too small on Fit, press **+** or choose Show last 14 days.

## In AviCore Crew — pilots see their own

Pilots open it at AviCore Crew → **Duty & Flight History** menu (next to FDT Monitor).

- One row: their own, with only the Daily Duty and roster of the signed-in pilot
- The same rules and colours as Admin, including the S/T / S / Free tags in Next 7 days
- No search box, no group bars and no Sim training panel
- Shows the last 14 days by default; switch to 7 / 28 / 56. On a phone, drag the table to scroll

## Cautions and FAQ

- **Next 7 days counts recorded duty only** — flights about to be crewed are not included yet. Once today's flying is recorded, the next days' hours left go down
- **The numbers are only as good as Daily Duty** — if a pilot has not recorded duty or the latest FDT is not imported, cells look like more is left than really is
- **168h for days ahead is read from the roster day by day** — use it to plan; for an hour-by-hour check use FDT Monitor
- **People decide** — this page helps you see; it does not build the schedule. The admin and crew scheduler must check and save every time

**Why don't the numbers match FDT Monitor?** Press Refresh on both pages. If they still differ, tell the admin with the pilot's name.

**Why is the Remark not what I expected?** Remark reads the Duty Schedule. Check that the roster was edited and saved, or imported again, then press Refresh here.

**What is the difference between OFF in Past days and OFF in Remark?** In Past days it is the Office duty type; in Remark and the Next 7 days cells it is a rostered day off.

**The roster says RR but the cell is not red?** Red text is only for the RR pair right before a 7-day OFF (21/7 pattern). Other RR days show the usual colour for the hours left. On the 168h line, RR of 2 or more days in a row shows RR ✓.

**The roster gives RR but 168h still shows hours, not RR ✓?** A single RR day (not next to OFF/VL/SL) is under 36h + 2 nights, so it is not a Recovery Rest yet.

**Why is a pilot with plenty of hours near the bottom?** They may be going to the sim — trip days and Free days before S/T do not count as days that can be flown.
