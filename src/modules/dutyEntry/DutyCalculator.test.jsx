// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import DutyCalculator from "./DutyCalculator.jsx";
import { DEFAULT_FTL_LIMITS as L } from "../../utils/ftlLimits.js";

describe("Duty Time Calculator - duty period", () => {
  it("Standby table has a Duty period column: report to engine stop + 30 min", () => {
    render(<DutyCalculator limits={L} />);
    const sec = screen.getByRole("region", { name: "Standby + Flight" });
    const box = within(sec).getByPlaceholderText("HH:MM (24h)");
    fireEvent.change(box, { target: { value: "17:30" } });
    fireEvent.blur(box);
    const table = within(sec).getByRole("table", { name: "Call-out times" });
    expect(within(table).getByText(/Duty period \(\+0:30 post-flight\)/)).toBeTruthy();
    const first = within(table).getAllByRole("row")[1];
    expect(first.textContent).toContain("18:30 – 05:00");
    expect(first.textContent).toContain("10:30");
  });

  it("Flying only shows the duty period row", () => {
    render(<DutyCalculator limits={L} />);
    const sec = screen.getAllByRole("region", { name: "FDP + Flight Time" })[0];
    const box = within(sec).getByPlaceholderText("HH:MM (24h)");
    fireEvent.change(box, { target: { value: "05:00" } });
    fireEvent.blur(box);
    expect(within(sec).getByText("Duty period")).toBeTruthy();
    expect(within(sec).getByText("10:30 hrs")).toBeTruthy();
    const post = within(sec).getByText("Post-flight").closest(".dcalc-row");
    expect(post.textContent).toContain("0:30 hrs");
    expect(post.textContent).toContain("engine stop 15:00 + 0:30 → 15:30");
  });
});
