// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DutyHistoryHelp, { parseManual } from "./DutyHistoryHelp.jsx";

describe("parseManual", () => {
  it("reads headings, paragraphs, lists and tables", () => {
    const md = "# Title\n\nSome **bold** text\nsame para\n\n- a\n- b\n\n1. one\n2. two\n\n| A | B |\n| --- | --- |\n| 1 | **2** |\n";
    expect(parseManual(md)).toEqual([
      { type: "h", level: 1, text: "Title" },
      { type: "p", text: "Some **bold** text same para" },
      { type: "ul", items: ["a", "b"] },
      { type: "ol", items: ["one", "two"] },
      { type: "table", head: ["A", "B"], rows: [["1", "**2**"]] }
    ]);
  });
});

describe("DutyHistoryHelp", () => {
  beforeEach(() => { try { window.localStorage.clear(); } catch { /* none */ } });

  it("shows the Thai manual first and switches to English", () => {
    render(<DutyHistoryHelp />);
    expect(screen.getByRole("heading", { name: /คู่มือ Duty & Flight History/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { name: /Crew Scheduler Manual/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Sim training — getting pilots ready/ })).toBeTruthy();
  });
});
