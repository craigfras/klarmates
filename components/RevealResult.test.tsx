import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RevealResult } from "@/components/RevealResult";
import type { GuessResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REAL_ANSWER = "Assembly on a mainframe";

const makeResult = (overrides: Partial<GuessResult> = {}): GuessResult => ({
  questionId: "q1",
  correct: true,
  realAnswerText: REAL_ANSWER,
  ...overrides,
});

// ---------------------------------------------------------------------------
// correct
// ---------------------------------------------------------------------------

describe("RevealResult: correct guess", () => {
  it("renders a status region with a ✓ and a 'Correct' label, plus the real answer", () => {
    render(<RevealResult result={makeResult({ correct: true })} />);

    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent("✓");
    expect(status).toHaveTextContent(/correct/i);
    expect(status).toHaveTextContent(REAL_ANSWER);
  });
});

// ---------------------------------------------------------------------------
// incorrect
// ---------------------------------------------------------------------------

describe("RevealResult: incorrect guess", () => {
  it("renders a status region with a ✗ and a 'Not quite' label, plus the real answer", () => {
    render(
      <RevealResult
        result={makeResult({ correct: false, realAnswerText: "C, of course" })}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent("✗");
    expect(status).toHaveTextContent(/not quite/i);
    expect(status).toHaveTextContent("C, of course");
  });
});
