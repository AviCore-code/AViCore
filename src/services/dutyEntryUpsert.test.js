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
const { fromMock, upsertMock, insertMock, updateMock, companiesMock } = vi.hoisted(() => {
  const upsertMock = vi.fn();
  const insertMock = vi.fn();
  const updateMock = vi.fn();
  // companiesMock: chain for from("companies").select().eq().maybeSingle()
  const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "test-company-uuid" }, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const companiesMock = { select };
  const fromMock = vi.fn((table) => {
    if (table === "companies") return companiesMock;
    return { upsert: upsertMock, insert: insertMock, update: updateMock };
  });
  return { fromMock, upsertMock, insertMock, updateMock, companiesMock };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: vi.fn(),
      // companyContext.js calls getSession to detect if user is authenticated;
      // in tests we return no session so it falls through to companySlug lookup.
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
    from: fromMock,
    // companyContext.js falls back to companies table lookup when no session;
    // stub it to return a fixed company id so rawAddDutyEntry can proceed.
    rpc: vi.fn(),
  }),
}));

async function loadWebDatabase() {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-anon-key");
  vi.stubEnv("VITE_COMPANY_SLUG", "test-company");
  return import("./webDatabase.js");
}

describe("addDutyEntry — typed-in upsert (no duplicate)", () => {
  beforeEach(() => {
    fromMock.mockReset();
    upsertMock.mockReset();
    insertMock.mockReset();
    updateMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("calls upsert (not insert) when adding a single typed-in duty entry", async () => {
    // Arrange: supabase.from().upsert() resolves successfully
    upsertMock.mockResolvedValue({ data: null, error: null });
    fromMock.mockImplementation((table) => table === "companies" ? companiesMock : { upsert: upsertMock, insert: insertMock });

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
    fromMock.mockImplementation((table) => table === "companies" ? companiesMock : { upsert: upsertMock, insert: insertMock });

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
    fromMock.mockImplementation((table) => table === "companies" ? companiesMock : { upsert: upsertMock, insert: insertMock });

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

  it("batch import upserts the same logical records instead of inserting duplicates", async () => {
    upsertMock.mockResolvedValue({ data: null, error: null });
    fromMock.mockImplementation((table) => table === "companies" ? companiesMock : { upsert: upsertMock, insert: insertMock });

    const { addDutyEntriesMany } = await loadWebDatabase();
    await addDutyEntriesMany("PDE", [{ date: "2026-09-19", dutyType: "flight", flightHours: 3 }]);

    expect(insertMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0][1]).toMatchObject({
      onConflict: "pilot_code,date,duty_type",
    });
  });

  it("propagates a supabase upsert error as a thrown Error", async () => {
    upsertMock.mockResolvedValue({ data: null, error: { message: "duplicate key value" } });
    fromMock.mockImplementation((table) => table === "companies" ? companiesMock : { upsert: upsertMock, insert: insertMock });

    const { addDutyEntry } = await loadWebDatabase();

    await expect(
      addDutyEntry({ pilotCode: "PDE", date: "2026-09-19", dutyType: "flight" })
    ).rejects.toThrow();
  });

  it("falls back to update-then-insert when Production lacks the conflict constraint", async () => {
    upsertMock.mockResolvedValue({
      data: null,
      error: { message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" },
    });
    const selectAfterUpdate = vi.fn().mockResolvedValue({ data: [{ uuid: "existing-row" }], error: null });
    const activeOnly = vi.fn().mockReturnValue({ select: selectAfterUpdate });
    const eqDutyType = vi.fn().mockReturnValue({ is: activeOnly });
    const eqDate = vi.fn().mockReturnValue({ eq: eqDutyType });
    const eqPilot = vi.fn().mockReturnValue({ eq: eqDate });
    updateMock.mockReturnValue({ eq: eqPilot });
    fromMock.mockImplementation((table) => table === "companies"
      ? companiesMock
      : { upsert: upsertMock, insert: insertMock, update: updateMock });

    const { addDutyEntry } = await loadWebDatabase();
    await addDutyEntry({
      pilotCode: "WJU",
      date: "2026-09-23",
      dutyType: "non_flight",
      activity: "Meeting",
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("still requires pilot_code and date — throws before calling supabase when missing", async () => {
    fromMock.mockImplementation((table) => table === "companies" ? companiesMock : { upsert: upsertMock, insert: insertMock });

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
