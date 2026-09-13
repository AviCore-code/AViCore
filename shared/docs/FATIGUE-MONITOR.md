# Fatigue Monitor — the rules, and where they come from

The company's Fatigue Monitor per **OPS-CM-01 §7.17.3**, as it will be
implemented in AviCore.

**Read this before changing any number below.** Every figure here came either
from the approved manual or from the spreadsheet the Crew Scheduler runs today —
none of it is invented, and the two sources *disagree in several places*. Where
they disagree, this file records which one AviCore follows and why, so a figure
that looks wrong later can be traced instead of "corrected" back into a bug.

Sources:

| Source | What it is |
|---|---|
| `OPS-CM-01 Operation Manual Part A Issue 07 (29 Apr 2025)` §7.17.3, p.7-24 | The CAAT-approved manual |
| `UOA PilotFlightTime_Monitor 2026.xlsm` → sheet `Fatique Module` | The fleet monitor's own summary of the rules |
| `<CODE>_FDT.xlsx` → sheet `DT`, columns AE–AK | **The formulas that actually run**, one workbook per pilot |

---

## Daily fatigue score

Four parameters, added together, scored once per duty day.

| # | Parameter | Points | Source column |
|---|---|---|---|
| 1 | Flight Duty Time | 0–6 | `AI` |
| 2 | Crews Number | 0–6 | `AF` |
| 3 | Sectors | 0–6 | `AG` |
| 4 | Flights per Day | 0–4 | `AH` |
| | **Daily total** | | `AJ = AF + AG + AH + AI` |

### 1. Flight Duty Time → points

```
AE = duty hours
>=7 → 6      >=6 → 5      >=5 → 4
>=4 → 3      >=3 → 2      >0  → 1      else 0
```

### 2. Crews Number → points

Determined by the **departure time band**, confirmed by Capt. Weera:

| Crew | Band | Points |
|---|---|---|
| Crew 1 | 22:30–06:59 | 6 |
| Crew 2 | 07:00–07:30 | 5 |
| Crew 3 | 07:31–08:00 | 4 |
| Crew 4 | 08:01–08:30 | 3 |
| Crew 5 | 08:31–09:00 | 2 |
| Crew 6 | 09:01–22:29 | 1 |

The bands are contiguous and wrap midnight, so every departure time maps to
exactly one Crew. **Crew 1 deliberately covers the whole night**: a night standby
called out at 02:00 scores 6, the maximum, because night flying is the most
fatiguing. Confirmed explicitly.

> ### ⚠ This is the one place AviCore does NOT follow the spreadsheet
>
> The live workbook computes Crews Number from a *duration* rather than a clock
> band — `DT!AF` reads `DT!Q`, which is
> `IF(L*24>=9,6, >=8.5,5, >=8,4, >=7.5,3, >=7,2, >=6.5,1)`.
>
> Capt. Weera was shown both and confirmed the **time bands above** are correct.
> So AviCore's Crews figure will legitimately differ from the spreadsheet's for
> the same duty. That is expected, not a defect — but it does mean the two cannot
> be reconciled cell-by-cell, and it is worth re-confirming with the Crew
> Scheduler before this drives any real decision.

### 3. Sectors → points

```
>10 → 6      >=9 → 5      >=7 → 4
>=5 → 3      >=4 → 2      >0  → 1      else 0
```

**Sectors are counted from the hyphens in the route string**, and **summed
across every flight that day** — not per flight:

```
VTSH-AQP-VTSH            → 2 sectors
VTSH-AQP//-BQP-VTSH      → 3 sectors     (the "//" is not special; count "-")

Flight 1: VTSH-TOPZ-VTSH        = 2
Flight 2: VTSH-A502-BQP-VTSH    = 3
                          day   = 5 sectors → 3 points
```

> The `Fatique Module` sheet labels this row **"Landing No."** and the DT sheet
> has a separate `Landings` column (`AG`) — but the scoring formula reads
> `DT!R`, whose header is **`Sectors`**. Sectors is therefore what counts.
> Capt. Weera's instruction ("ดูว่าตัวเลขจำนวน landing กับจำนวน sector อันไหน
> มากกว่า เอาอันนั้น") is satisfied because on these routes sectors ≥ landings.

### 4. Flights per Day → points

```
3 flights → 4      2 → 2      1 → 1      else 0
```

### Limits

| Check | Limit |
|---|---|
| One day | **< 22** |
| Two consecutive days | **< 40** |

---

## Where the manual and the spreadsheet disagree

The PDF is the approved document; the spreadsheet is what is actually run daily.
**AviCore follows the spreadsheet**, on Capt. Weera's instruction — it is newer
and it is what produces the figures the Crew Scheduler works from.

| | PDF §7.17.3 | Working spreadsheet | AviCore |
|---|---|---|---|
| Parameter 1 name | "FDP Hours" | "Flight Duty Time" | spreadsheet |
| Parameter 1 threshold | `>7=6` | `>=7=6` | spreadsheet |
| Parameter 3 name | "Number of Sector Flown" | "Landing No." (but reads the *Sectors* column) | Sectors |
| Sector thresholds | `10=6, 9=5, 7=4, 5=3, 4=2, <3=0` | `>10=6, >=9=5, >=7=4, >=5=3, >=4=2, >0=1` | spreadsheet |
| Minimum score | `0` | **`1`** on all three ≥-scales | spreadsheet |
| 1 flight/day | `0` | **`1`** | spreadsheet |
| Crew 4 | *missing from the table* | `Crew4=3` | `Crew4=3` |
| Crews Number basis | T/O time | duration `L*24` | **time bands** (see ⚠ above) |

The PDF's minimum of `0` matters: under the spreadsheet a pilot who flies at all
scores at least 3 (1+1+1) before Flight Duty Time is even added, so the floor is
not zero. Anyone comparing AviCore against the manual will see this immediately.

---

## Weekly Fatigue Index (§7.17.3.2)

Two variants exist in `UOA PilotFlightTime_Monitor 2026.xlsm`:

**`FT & Fatique Weekly Monitor`** — matches the PDF, TOTAL INDEX out of 5:

```
O = ABS(FT 1x28)          → 0.0 – 4.00
P = Fatique Value / 154   → 0.0 – 1.00
Q = O + P                 → TOTAL INDEX (max 5)
```

**`Fatigue Weekly Monitor`** — a duty-time variant, TOTAL INDEX out of 3.5:

```
O = ABS(DT 1 week)        → 0.0 – 2.50
P = Fatique Value / 154   → 0.0 – 1.00
Q = O + P                 → TOTAL INDEX (max 3.5)
```

**A TOTAL INDEX approaching its maximum means the pilot should not be assigned
flight duty.** If no one else is available, the Chief Pilot or Flight Operations
Manager must be notified.

### What AviCore implements — CONFIRMED

AviCore implements the **duty-time variant**, TOTAL INDEX out of **3.5**:

```
DT INDEX      = ABS(DT 1 week)        = DT hours / 24     → 0.0 – 2.50
FATIGUE INDEX = Fatique Value / 154                       → 0.0 – 1.00
TOTAL INDEX   = DT INDEX + FATIGUE INDEX                  → max 3.5
```

Both divisors were confirmed by Capt. Weera on 29 Jul 2026, with the reasoning
for each — which is what makes them safe to rely on:

**1. The divisor is 154, and here is why.**

> *"หาร ด้วย 154 ซึ่งมาค่า fatigue 1 วันสูงสุด 22 X 7 วัน เท่ากับ 154"*

154 = **22 × 7** — the daily cap (22) across a rolling week. This confirms the
numerator is a **7-day** total, not the PDF's 2-day figure, and settles the
discrepancy with the PDF's "Fatigue Value 40 ÷ 40".

**2. `ABS(H:mm)` means "convert the time to a number", i.e. hours ÷ 24.**

> *"DT (1W 60) เลย ใช้ ABS(ชั่วโมงการทำงาน) = ตัวเลข ในที่นี้ MAX 60 hrs.
> DT 1w ABS(60)=2.5"*

So the DT limit of **60 hrs/week** is what sets the DT INDEX ceiling:
`60 ÷ 24 = 2.50`. The 3.5 maximum is therefore *derived* (2.5 + 1.0), not an
assumed constant — verified against the code, which returns exactly 2.5 for a
60-hour week.

Note this is the **`Fatigue Weekly Monitor`** variant (DT-based, max 3.5), NOT
the `FT & Fatique Weekly Monitor` variant (FT-based, max 5). The `FT(3x28)` vs
`FT(1x28)` question in the PDF applies only to the FT variant and therefore does
not affect what AviCore computes.

---

## The criteria are editable — under control

Capt. Weera asked (29 Jul 2026) for the four scoring criteria to be adjustable
in the app: **Flight Duty Time**, **Crew Number (departure time bands)**,
**Flights per Day**, and **Sector/Landing**. Flight Time is *not* one of them —
it does not feed the daily score.

They are edited at **Settings → Fatigue Criteria** (Admin build only; the Crew
app has its own separate Settings and cannot reach this).

Because these figures go to the CAAT quarterly, editing is deliberately
constrained:

| Control | What it prevents |
|---|---|
| `OPS_CM_01` frozen in `src/utils/fatigueCriteria.js` | The approved values can always be restored — "Reset to OPS-CM-01" |
| `validateCriteria()` blocks saving | A blank threshold would score every duty **0**, showing a tired crew as rested |
| `isModified()` banner on the Fatigue page | A figure from unapproved criteria can never be mistaken for the approved one. The banner **prints**, so a printout handed to the regulator carries the caveat too |
| Change log (`fatigue_criteria_log`) | Every save is stamped with what changed, so a past return can be explained |

**The action bands do not move.** "Closely Monitor" at 2.50 and "Recovery rest
required" at 3.00 are regulatory *actions* from the manual, not points on a
curve. If a custom limit lowers the ceiling below a band, that band becomes
unreachable rather than being silently rescaled — inventing a moved threshold
would be writing a rule OPS-CM-01 does not contain.

**Defaults are regression-tested.** `avicore-test/src/utils/fatigueCriteria.test.js`
asserts that the default criteria reproduce the previously hardcoded figures
exactly — including all 1440 minutes of the Crews bands and the 3.5 index
ceiling. Making the criteria editable must never change what the *approved*
criteria produce.

---

## Reporting obligation

> *"An analysis of the fatigue assessment is to be submitted to the CAAT every 3
> months."* — §7.17.3.2

This is a regulatory submission, not an internal metric. Any change to the
figures above changes what is reported to the regulator, which is why this
document exists and why guessed values are not acceptable in it.
