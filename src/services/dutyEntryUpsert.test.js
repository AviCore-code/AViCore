/**
 * RED tests — typed-in duty entry upsert behaviour.
 *
 * When a user types in a duty entry for a pilot+date+duty_type that already
 * exists in the database (either from a previous typed-in entry or from an
 * FDT file import), rawAddDutyEntry must overwrite (upsert) the existing row
 * instead of inserting a new one, preventing duplicate duty records.
 *
 * Conflict resolution key: pilot_code + date + duty_type
 * (unique constraint "Admin_pilot_duty_entries_pilot_date_type_key" added in
 *  migration 20260919_typed_in_upsert.sql)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock — must mirror real Supabase chaining interface.
const { fromMock, upsertMock, insertMock } = vi.hoisted(() => {
  const upsertMock = vi.fn();
  const insertMock = vi.fn();
  const fromMock = vi.fn();
  return { fromMock, upsertMock, insertMock };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { onAuthStateChange: vi.fn() },
    from: fromMock,
  }),
}));

async function loadWebDatabase() {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-anon-key");
  return import("./webDatabase.js");
}

describe("addDutyEntry — typed-in upsert (no duplicate)", () => {
  beforeEach(() => {
    fromMock.mockReset();
    upsertMock.mockReset();
    insertMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("calls upsert (not insert) when adding a single typed-in duty entry", async () => {
    // Arrange: supabase.from().upsert() resolves successfully
    upsertMock.mockResolvedValue({ data: null, error: null });
    fromMock.mockReturnValue({ upsert: upsertMock });

    const { addDutyEntry } = await loadWebDatabase();

    const entry = {
      pilotCode: "PDE",
      date: "2026-09-19",
      dutyType: "flight",
      flightHours: 3,
      nonFlightHours: 0,
      aircraftType: "AW139",
    };

    await addDutyEntry(entry);

    // Must use upsert, NOT insert
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();

    const upsertArg = upsertMock.mock.calls[0][0];
    expect(upsertArg).toMatchObject({
      pilot_code: "PDE",
      date: "2026-09-19",
      duty_type: "flight",
    });
  });

  it("upsert uses pilot_code+date+duty_type as the conflict resolution key", async () => {
    upsertMock.mockResolvedValue({ data: null, error: null });
    fromMock.mockReturnValue({ upsert: upsertMock });

    const { addDutyEntry } = await loadWebDatabase();

    await addDutyEntry({
      pilotCode: "TBO",
      date: "2026-09-18",
      dutyType: "non_flight",
      nonFlightHours: 4,
    });

    // Second argument to upsert must specify onConflict
    const upsertOptions = upsertMock.mock.calls[0][1];
    expect(upsertOptions).toMatchObject({
      onConflict: "pilot_code,date,duty_type",
    });
  });

  it("overwrites the existing row — upsert with ignoreDuplicates:false", async () => {
    upsertMock.mockResolvedValue({ data: null, error: null });
    fromMock.mockReturnValue({ upsert: upsertMock });

    const { addDutyEntry } = await loadWebDatabase();

    await addDutyEntry({
      pilotCode: "PDE",
      date: "2026-09-19",
      dutyType: "flight",
      flightHours: 5,
    });

    const upsertOptions = upsertMock.mock.calls[0][1];
    // ignoreDuplicates:false means the row IS updated on conflict (default,
    // but must be explicit — ignoreDuplicates:true would silently skip it)
    expect(upsertOptions?.ignoreDuplicates).not.toBe(true);
  });

  it("propagates a supabase upsert error as a thrown Error", async () => {
    upsertMock.mockResolvedValue({ data: null, error: { message: "duplicate key value" } });
    fromMock.mockReturnValue({ upsert: upsertMock });

    const { addDutyEntry } = await loadWebDatabase();

    await expect(
      addDutyEntry({ pilotCode: "PDE", date: "2026-09-19", dutyType: "flight" })
    ).rejects.toThrow();
  });

  it("still requires pilot_code and date — throws before calling supabase when missing", async () => {
    fromMock.mockReturnValue({ upsert: upsertMock });

    const { addDutyEntry } = await loadWebDatabase();

    await expect(addDutyEntry({ date: "2026-09-19", dutyType: "flight" })).rejects.toThrow(
      /pilot code/i
    );
    await expect(addDutyEntry({ pilotCode: "PDE", dutyType: "flight" })).rejects.toThrow(
      /date/i
    );

    expect(upsertMock).not.toHaveBeenCalled();
  });
});
