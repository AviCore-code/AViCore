import { describe, it, expect } from "vitest";
import { 
  scoreIntentMatches, 
  detectAmbiguity, 
  generateClarificationPrompt,
  isVagueQuery 
} from "./intent-learning.js";

describe("Intent Learning", () => {
  it("scores intent matches for clear queries", () => {
    const results = scoreIntentMatches("training PDE");
    expect(results[0].intent).toBe("training");
    expect(results[0].confidence).toBeGreaterThan(0.3);
  });

  it("scores intent matches for Thai queries", () => {
    const results = scoreIntentMatches("ใครหมดอายุ");
    const match = results.find(r => r.intent === "overdue");
    expect(match).toBeDefined();
    expect(match.confidence).toBeGreaterThan(0.3);
  });

  it("detects ambiguous queries (multiple high-confidence matches)", () => {
    const matches = [
      { intent: "training", confidence: 0.8 },
      { intent: "overdue", confidence: 0.7 },
    ];
    const ambiguity = detectAmbiguity("night training overdue", matches);
    expect(ambiguity.ambiguous).toBe(true);
    expect(ambiguity.candidates.length).toBeGreaterThan(1);
  });

  it("does not flag single clear match as ambiguous", () => {
    const matches = [
      { intent: "training", confidence: 0.9 },
      { intent: "experience", confidence: 0.2 },
    ];
    const ambiguity = detectAmbiguity("training hours", matches);
    expect(ambiguity).toBeNull();
  });

  it("detects vague queries (too short)", () => {
    expect(isVagueQuery("ใคร")).toBe(true);
    expect(isVagueQuery("training")).toBe(false); // known intent keyword
  });

  it("generates clarification prompt for ambiguity", () => {
    const ambiguity = {
      ambiguous: true,
      candidates: [
        { intent: "training", confidence: 0.8 },
        { intent: "overdue", confidence: 0.7 },
      ],
    };
    const prompt = generateClarificationPrompt(ambiguity);
    expect(prompt).toContain("ไม่แน่ใจ");
    expect(prompt).toContain("Training");
    expect(prompt).toContain("Overdue");
  });

  it("handles empty intent aliases gracefully", () => {
    const results = scoreIntentMatches("xyz abc 123");
    expect(results.length).toBe(0);
  });
});
