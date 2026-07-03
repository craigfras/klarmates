import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuessForm } from "@/components/GuessForm";
import { ToastProvider, ToastViewport } from "@/components/Toast";
import type { GuessResult, GuessSheet } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEK_ID = "week-2026-25";
const GUESSES_ENDPOINT = "/api/me/guesses";
const EXPECTED_QUESTION_COUNT = 4;
const OPTIONS_PER_QUESTION = 4;
const SPINNER_TEST_ID = "spinner";
const FIRST_QUESTION_INDEX = 0;
const SECOND_QUESTION_INDEX = 1;
const EXPECTED_ONE_SPINNER = 1;

// --- Completion-flow constants ---------------------------------------------

const HOME_ROUTE = "/";
const OK_LABEL = "OK";
const EXPECTED_ONE_CALL = 1;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// The form refreshes after each guess and pushes "/" when the score modal's OK
// is clicked; both router methods are mocked so either can be asserted.
const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

// A four-question sheet, four options each. Real answer text is encoded for the
// reveal assertions; the form itself never knows which is correct.
const SHEET: GuessSheet = [
  {
    questionId: "q-first-language",
    questionText: "What was your first programming language?",
    options: [
      { id: "q1-opt-0", text: "Assembly on a mainframe" },
      { id: "q1-opt-1", text: "BASIC on a home computer" },
      { id: "q1-opt-2", text: "Pascal at university" },
      { id: "q1-opt-3", text: "Java in a bootcamp" },
    ],
    result: null,
  },
  {
    questionId: "q-debug-snack",
    questionText: "Go-to debugging snack?",
    options: [
      { id: "q2-opt-0", text: "Black coffee, no snacks" },
      { id: "q2-opt-1", text: "Cold leftover pizza" },
      { id: "q2-opt-2", text: "A fresh pot of tea" },
      { id: "q2-opt-3", text: "Energy drinks only" },
    ],
    result: null,
  },
  {
    questionId: "q-editor",
    questionText: "Editor you could never give up?",
    options: [
      { id: "q3-opt-0", text: "Emacs, naturally" },
      { id: "q3-opt-1", text: "Vim until I die" },
      { id: "q3-opt-2", text: "VS Code, obviously" },
      { id: "q3-opt-3", text: "Whatever compiles cleanly" },
    ],
    result: null,
  },
  {
    questionId: "q-side-project",
    questionText: "Side project you are proud of?",
    options: [
      { id: "q4-opt-0", text: "A poetry-generating algorithm" },
      { id: "q4-opt-1", text: "A toy operating-system kernel" },
      { id: "q4-opt-2", text: "A self-hosting compiler" },
      { id: "q4-opt-3", text: "A budgeting app for friends" },
    ],
    result: null,
  },
];

type FetchResponse = { ok: boolean; json: () => Promise<unknown> };

/**
 * Installs a typed fetch mock. The call signature is explicit so destructuring
 * `.mock.calls[0]` stays well-typed under `tsc --noEmit`.
 */
const mockFetch = (impl: (url: string, init: RequestInit) => Promise<FetchResponse>) => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<FetchResponse>>(
    impl,
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const okResult = (result: GuessResult): FetchResponse => ({
  ok: true,
  json: async () => result,
});

/**
 * Returns a copy of SHEET with a prior `result` attached to the item at the
 * given index — simulating a question the player has already guessed. The
 * `correct` flag drives the week-score count assertions.
 */
const withPriorResult = (index: number, correct: boolean): GuessSheet =>
  SHEET.map((item, i) =>
    i === index
      ? {
          ...item,
          result: {
            questionId: item.questionId,
            correct,
            realAnswerText: `prior-answer-${item.questionId}`,
          },
        }
      : { ...item, result: null },
  );

/**
 * Returns a copy of SHEET with EVERY item pre-resolved. `correctCount` of them
 * are correct (the first N), the rest incorrect — a returning, fully-complete
 * player.
 */
const allResolved = (correctCount: number): GuessSheet =>
  SHEET.map((item, i) => ({
    ...item,
    result: {
      questionId: item.questionId,
      correct: i < correctCount,
      realAnswerText: `prior-answer-${item.questionId}`,
    },
  }));

const notOk = (): FetchResponse => ({ ok: false, json: async () => ({}) });

// Renders the form inside the toast context so success/error toasts can be
// asserted via role="status".
const renderWithToasts = (sheet: GuessSheet, weekId: string) =>
  render(
    <ToastProvider>
      <GuessForm sheet={sheet} weekId={weekId} />
      <ToastViewport />
    </ToastProvider>,
  );

/**
 * A manually-resolvable fetch. Lets a test assert the in-flight spinner on the
 * clicked question's button BEFORE resolving, then resolve to see the toast.
 */
const createDeferredFetch = (response: FetchResponse) => {
  let resolveFetch!: () => void;
  const pending = new Promise<void>((resolve) => {
    resolveFetch = resolve;
  });
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<FetchResponse>>(
    () => pending.then(() => response),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, resolve: resolveFetch };
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  refresh.mockClear();
  push.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

describe("GuessForm: rendering", () => {
  it("renders each question with its options as accessible radios", () => {
    mockFetch(async () => okResult({ questionId: "q1", correct: true, realAnswerText: "x" }));
    render(<GuessForm sheet={SHEET} weekId={WEEK_ID} />);

    for (const item of SHEET) {
      expect(screen.getByText(item.questionText)).toBeInTheDocument();
      for (const option of item.options) {
        // Each radio carries an accessible label equal to the option text.
        expect(screen.getByLabelText(option.text)).toBeInTheDocument();
      }
    }

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(EXPECTED_QUESTION_COUNT * OPTIONS_PER_QUESTION);
  });

  it("renders one Guess submit button per question", () => {
    mockFetch(async () => okResult({ questionId: "q1", correct: true, realAnswerText: "x" }));
    render(<GuessForm sheet={SHEET} weekId={WEEK_ID} />);

    const buttons = screen.getAllByRole("button", { name: /guess/i });
    expect(buttons).toHaveLength(EXPECTED_QUESTION_COUNT);
  });
});

// ---------------------------------------------------------------------------
// successful guess: POST shape, reveal, lock
// ---------------------------------------------------------------------------

describe("GuessForm: successful guess", () => {
  it("POSTs the selected option once and reveals + locks that question", async () => {
    const result: GuessResult = {
      questionId: "q-first-language",
      correct: true,
      realAnswerText: "Assembly on a mainframe",
    };
    const fetchMock = mockFetch(async () => okResult(result));
    const user = userEvent.setup();
    render(<GuessForm sheet={SHEET} weekId={WEEK_ID} />);

    // Select an option for the first question and submit it.
    await user.click(screen.getByLabelText("Assembly on a mainframe"));
    const firstButton = screen.getAllByRole("button", { name: /guess/i })[0];
    await user.click(firstButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(GUESSES_ENDPOINT);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      weekId: WEEK_ID,
      questionId: "q-first-language",
      chosenOptionId: "q1-opt-0",
    });

    // The reveal appears with the real answer text.
    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("Assembly on a mainframe");
    });

    // That question is locked: its radios and its button become disabled.
    await waitFor(() => {
      expect(screen.getByLabelText("Assembly on a mainframe")).toBeDisabled();
    });
    expect(
      screen.getByLabelText("BASIC on a home computer"),
    ).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /guess/i })[0]).toBeDisabled();
  });

  it("disables a question's submit button until an option is selected", () => {
    mockFetch(async () => okResult({ questionId: "q1", correct: true, realAnswerText: "x" }));
    render(<GuessForm sheet={SHEET} weekId={WEEK_ID} />);

    // No selection yet → first question's Guess button is disabled.
    expect(screen.getAllByRole("button", { name: /guess/i })[0]).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// error path: keeps the question editable
// ---------------------------------------------------------------------------

describe("GuessForm: failed guess", () => {
  it("shows a role=alert error and keeps the question editable when the response is not ok", async () => {
    mockFetch(async () => notOk());
    const user = userEvent.setup();
    render(<GuessForm sheet={SHEET} weekId={WEEK_ID} />);

    await user.click(screen.getByLabelText("Vim until I die"));
    // The editor question is the third in the sheet.
    const editorButton = screen.getAllByRole("button", { name: /guess/i })[2];
    await user.click(editorButton);

    // An error is surfaced.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // No reveal happened.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // The question remains editable: its radio is still enabled.
    expect(screen.getByLabelText("Vim until I die")).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// independence: locking one question leaves the others editable
// ---------------------------------------------------------------------------

describe("GuessForm: per-question independence", () => {
  it("locks only the submitted question, leaving the rest answerable", async () => {
    const result: GuessResult = {
      questionId: "q-first-language",
      correct: false,
      realAnswerText: "Assembly on a mainframe",
    };
    mockFetch(async () => okResult(result));
    const user = userEvent.setup();
    render(<GuessForm sheet={SHEET} weekId={WEEK_ID} />);

    await user.click(screen.getByLabelText("BASIC on a home computer"));
    await user.click(screen.getAllByRole("button", { name: /guess/i })[0]);

    await waitFor(() => {
      expect(screen.getByLabelText("BASIC on a home computer")).toBeDisabled();
    });

    // A second, untouched question's options remain enabled.
    const secondQuestion = screen.getByText("Go-to debugging snack?");
    expect(secondQuestion).toBeInTheDocument();
    expect(screen.getByLabelText("Cold leftover pizza")).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// per-question spinner while in flight + success toast (new UX feature)
// ---------------------------------------------------------------------------

describe("GuessForm: in-flight spinner and toasts", () => {
  it("shows only the clicked question's button spinner while its guess is pending", async () => {
    const { resolve } = createDeferredFetch(
      okResult({
        questionId: "q-first-language",
        correct: true,
        realAnswerText: "Assembly on a mainframe",
      }),
    );
    const user = userEvent.setup();
    renderWithToasts(SHEET, WEEK_ID);

    // Select and submit the FIRST question only.
    await user.click(screen.getByLabelText("Assembly on a mainframe"));
    const firstButton = screen.getAllByRole("button", { name: /guess/i })[
      FIRST_QUESTION_INDEX
    ];
    await user.click(firstButton);

    // The first question's button is busy/disabled with a spinner...
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /guess/i })[FIRST_QUESTION_INDEX],
      ).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getAllByTestId(SPINNER_TEST_ID)).toHaveLength(
      EXPECTED_ONE_SPINNER,
    );

    // ...while a second, untouched question's button is NOT busy.
    expect(
      screen.getAllByRole("button", { name: /guess/i })[SECOND_QUESTION_INDEX],
    ).not.toHaveAttribute("aria-busy", "true");

    resolve();
  });

  it("raises a success toast on a successful guess", async () => {
    const { resolve } = createDeferredFetch(
      okResult({
        questionId: "q-first-language",
        correct: true,
        realAnswerText: "Assembly on a mainframe",
      }),
    );
    const user = userEvent.setup();
    renderWithToasts(SHEET, WEEK_ID);

    await user.click(screen.getByLabelText("Assembly on a mainframe"));
    await user.click(screen.getAllByRole("button", { name: /guess/i })[FIRST_QUESTION_INDEX]);

    resolve();

    // The toast lives inside the polite live region; scope the query to it so
    // the inline reveal (also role="status") is not mistaken for the toast.
    await waitFor(() => {
      const region = screen.getByRole("region");
      const toast = within(region).getByRole("status");
      expect(toast).toHaveAttribute("data-variant", "success");
    });
  });
});

// ---------------------------------------------------------------------------
// pre-lock from sheet: a question with a prior result is locked on mount
// ---------------------------------------------------------------------------

describe("GuessForm: pre-lock from sheet result", () => {
  it("renders a question with a non-null prior result as locked/revealed without a click", async () => {
    // The first question already carries a correct prior guess.
    const sheet = withPriorResult(FIRST_QUESTION_INDEX, true);
    mockFetch(async () =>
      okResult({ questionId: "unused", correct: true, realAnswerText: "x" }),
    );
    renderWithToasts(sheet, WEEK_ID);

    // The prior reveal is shown for the locked question — its real answer text
    // appears in a status region, with no user interaction.
    const priorAnswer = `prior-answer-${sheet[FIRST_QUESTION_INDEX].questionId}`;
    await waitFor(() => {
      expect(screen.getByText(new RegExp(priorAnswer))).toBeInTheDocument();
    });

    // The first question's radios are disabled (locked).
    expect(screen.getByLabelText("Assembly on a mainframe")).toBeDisabled();
    // Its Guess button is disabled (no re-guessing).
    expect(
      screen.getAllByRole("button", { name: /guess/i })[FIRST_QUESTION_INDEX],
    ).toBeDisabled();
  });

  it("leaves the other (result:null) questions guessable", () => {
    const sheet = withPriorResult(FIRST_QUESTION_INDEX, true);
    mockFetch(async () =>
      okResult({ questionId: "unused", correct: true, realAnswerText: "x" }),
    );
    renderWithToasts(sheet, WEEK_ID);

    // A second, un-resolved question's options remain enabled.
    expect(screen.getByLabelText("Cold leftover pizza")).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// score modal on completion: guessing the last question opens the dialog
// ---------------------------------------------------------------------------

describe("GuessForm: score modal on completion", () => {
  it("shows a score dialog with the correct count and total once every question is resolved", async () => {
    // Three of four already resolved (two correct), one remaining. Guessing the
    // last one CORRECTLY makes the week score 3 of 4.
    const PRIOR_CORRECT = 2;
    const sheet = SHEET.map((item, i) => ({
      ...item,
      result:
        i < PRIOR_CORRECT
          ? {
              questionId: item.questionId,
              correct: true,
              realAnswerText: `prior-answer-${item.questionId}`,
            }
          : i === PRIOR_CORRECT
            ? {
                questionId: item.questionId,
                correct: false,
                realAnswerText: `prior-answer-${item.questionId}`,
              }
            : null,
    }));
    const LAST_INDEX = SHEET.length - 1;
    const EXPECTED_CORRECT = 3; // two prior + the final correct guess
    const TOTAL_QUESTIONS = SHEET.length; // 4

    mockFetch(async () =>
      okResult({
        questionId: SHEET[LAST_INDEX].questionId,
        correct: true,
        realAnswerText: "A budgeting app for friends",
      }),
    );
    const user = userEvent.setup();
    renderWithToasts(sheet, WEEK_ID);

    // Resolve the only remaining question.
    await user.click(screen.getByLabelText("A budgeting app for friends"));
    await user.click(
      screen.getAllByRole("button", { name: /guess/i })[LAST_INDEX],
    );

    // A modal dialog appears reporting the week's score.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // It conveys a score out of the total: both the correct count and the
    // total appear, with score-ish phrasing.
    expect(within(dialog).getByText(/score|correct|of/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(new RegExp(String(EXPECTED_CORRECT))),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(new RegExp(String(TOTAL_QUESTIONS))),
    ).toBeInTheDocument();
  });

  it("navigates home when the modal's OK button is clicked", async () => {
    const PRIOR_RESOLVED = SHEET.length - 1;
    const sheet = SHEET.map((item, i) => ({
      ...item,
      result:
        i < PRIOR_RESOLVED
          ? {
              questionId: item.questionId,
              correct: true,
              realAnswerText: `prior-answer-${item.questionId}`,
            }
          : null,
    }));
    const LAST_INDEX = SHEET.length - 1;

    mockFetch(async () =>
      okResult({
        questionId: SHEET[LAST_INDEX].questionId,
        correct: true,
        realAnswerText: "A budgeting app for friends",
      }),
    );
    const user = userEvent.setup();
    renderWithToasts(sheet, WEEK_ID);

    await user.click(screen.getByLabelText("A budgeting app for friends"));
    await user.click(
      screen.getAllByRole("button", { name: /guess/i })[LAST_INDEX],
    );

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: OK_LABEL }));

    expect(push).toHaveBeenCalledTimes(EXPECTED_ONE_CALL);
    expect(push).toHaveBeenCalledWith(HOME_ROUTE);
  });
});

// ---------------------------------------------------------------------------
// mounted already-complete: no auto-modal for a returning player
// ---------------------------------------------------------------------------

describe("GuessForm: mounted already-complete", () => {
  it("shows NO dialog on initial render when every question already has a result", () => {
    const ALL_CORRECT = SHEET.length;
    const sheet = allResolved(ALL_CORRECT);
    mockFetch(async () =>
      okResult({ questionId: "unused", correct: true, realAnswerText: "x" }),
    );
    renderWithToasts(sheet, WEEK_ID);

    // The modal only appears after completing a guess in-session, never on mount.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders every question locked/revealed for a fully-complete sheet", () => {
    const ALL_CORRECT = SHEET.length;
    const sheet = allResolved(ALL_CORRECT);
    mockFetch(async () =>
      okResult({ questionId: "unused", correct: true, realAnswerText: "x" }),
    );
    renderWithToasts(sheet, WEEK_ID);

    // No question is still guessable: every Guess button is disabled.
    const buttons = screen.getAllByRole("button", { name: /guess/i });
    expect(buttons).toHaveLength(EXPECTED_QUESTION_COUNT);
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }

    // Every option radio is disabled (locked).
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });
});
