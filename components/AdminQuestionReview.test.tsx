/**
 * AdminQuestionReview component tests.
 *
 * ---------------------------------------------------------------------------
 * Contract decisions documented for the code-writer
 * ---------------------------------------------------------------------------
 * Props:       { weekId: string; questions: Question[] }
 * Endpoints:   POST /api/admin/week/questions   (edit + regenerate)
 *              POST /api/admin/week/approve      (approve & open week)
 *
 * Button / aria labels the implementation MUST match:
 *   - Per-question save button:       "Save" (aria-label or accessible name)
 *   - Per-question regenerate button: "Regenerate"
 *   - Approve action button:          "Approve & open week"
 *
 * Edit flow:
 *   User edits a question's text input, then clicks its "Save" button.
 *   POSTs { action: "edit", questionId, text } to /api/admin/week/questions.
 *
 * Regenerate flow:
 *   User clicks a question's "Regenerate" button.
 *   POSTs { action: "regenerate", questionId } to /api/admin/week/questions.
 *
 * Approve flow:
 *   User clicks "Approve & open week".
 *   POSTs { weekId } to /api/admin/week/approve.
 *
 * On success: router.refresh() is called.
 * On failure: an error message appears (role="alert"), no throw.
 * ---------------------------------------------------------------------------
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Question, QuestionSuggestion } from "@/lib/types";
import { WEEKLY_QUESTION_COUNT } from "@/lib/types";
import { AdminQuestionReview } from "@/components/AdminQuestionReview";
import { ToastProvider, ToastViewport } from "@/components/Toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEK_ID = "week-2026-26";
// ISO start date for the week being drafted; drives the "week of <date>" label.
const WEEK_STARTS_AT = "2026-06-29T00:00:00.000Z";
const FORMATTED_WEEK_DATE = "Jun 29, 2026";
const QUESTIONS_ENDPOINT = "/api/admin/week/questions";
const APPROVE_ENDPOINT = "/api/admin/week/approve";
const APPROVE_BUTTON_LABEL = "Approve & open week";
const SAVE_BUTTON_LABEL = "Save";
const REGENERATE_BUTTON_LABEL = "Regenerate";
const SPINNER_TEST_ID = "spinner";
const EXPECTED_ONE_SPINNER = 1;
const FIRST_QUESTION_INDEX = 0;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Exactly WEEKLY_QUESTION_COUNT (4) draft questions — asserts the component
// renders one editable field per question.
const DRAFT_QUESTIONS: Question[] = Array.from(
  { length: WEEKLY_QUESTION_COUNT },
  (_, i) => ({
    id: `draft-q${i}`,
    orderIndex: i,
    text: `Draft question ${i + 1} text?`,
  }),
);

// Updated list returned by the service after an edit/regenerate action.
const UPDATED_QUESTIONS: Question[] = DRAFT_QUESTIONS.map((q, i) =>
  i === 0 ? { ...q, text: "Edited question text?" } : q,
);

// Default suggestions prop for the pre-existing draft/edit/regenerate/approve
// tests — those flows do not exercise the suggestions panel, so they pass an
// empty pool. The new prop is REQUIRED, so every render must supply it.
const NO_SUGGESTIONS: QuestionSuggestion[] = [];

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

type MockResponseInit = { ok: boolean; json: () => Promise<unknown> };

const mockFetch = (impl: () => Promise<MockResponseInit>) => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<MockResponseInit>>(impl);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const successQuestionsResponse = (): Promise<MockResponseInit> =>
  Promise.resolve({
    ok: true,
    json: async () => ({ questions: UPDATED_QUESTIONS }),
  });

const successApproveResponse = (): Promise<MockResponseInit> =>
  Promise.resolve({
    ok: true,
    json: async () => ({ ok: true }),
  });

const failureResponse = (errorMessage = "nope"): Promise<MockResponseInit> =>
  Promise.resolve({
    ok: false,
    json: async () => ({ error: errorMessage }),
  });

// Renders the component inside the toast context so success toasts can be
// asserted via role="status" inside the polite live region.
const renderWithToasts = (
  questions: Question[] = DRAFT_QUESTIONS,
  suggestions: QuestionSuggestion[] = NO_SUGGESTIONS,
) =>
  render(
    <ToastProvider>
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={questions}
        suggestions={suggestions}
      />
      <ToastViewport />
    </ToastProvider>,
  );

/**
 * A manually-resolvable fetch. Lets a test assert the in-flight spinner on the
 * clicked action's button BEFORE resolving, then resolve to see the toast.
 */
const createDeferredFetch = (response: MockResponseInit) => {
  let resolveFetch!: () => void;
  const pending = new Promise<void>((resolve) => {
    resolveFetch = resolve;
  });
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<MockResponseInit>>(
    () => pending.then(() => response),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, resolve: resolveFetch };
};

const successQuestionsResult: MockResponseInit = {
  ok: true,
  json: async () => ({ questions: UPDATED_QUESTIONS }),
};

const successApproveResult: MockResponseInit = {
  ok: true,
  json: async () => ({ ok: true }),
};

const successToast = () => within(screen.getByRole("region")).getByRole("status");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

describe("AdminQuestionReview: rendering", () => {
  it("renders one editable text input per question, pre-filled with the question text", () => {
    mockFetch(successQuestionsResponse);
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    for (const question of DRAFT_QUESTIONS) {
      // Each input must be labelled by (or have value matching) the question text.
      const input = screen.getByDisplayValue(question.text);
      expect(input).toBeInTheDocument();
      expect((input as HTMLInputElement).value).toBe(question.text);
    }

    // Exactly WEEKLY_QUESTION_COUNT inputs present.
    expect(screen.getAllByDisplayValue(/Draft question/)).toHaveLength(WEEKLY_QUESTION_COUNT);
  });

  it("renders a Regenerate button for every question", () => {
    mockFetch(successQuestionsResponse);
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    const regenerateButtons = screen.getAllByRole("button", { name: REGENERATE_BUTTON_LABEL });
    expect(regenerateButtons).toHaveLength(WEEKLY_QUESTION_COUNT);
  });

  it("renders a Save button for every question", () => {
    mockFetch(successQuestionsResponse);
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    const saveButtons = screen.getAllByRole("button", { name: SAVE_BUTTON_LABEL });
    expect(saveButtons).toHaveLength(WEEKLY_QUESTION_COUNT);
  });

  it("renders a label naming the week the questions are for, using the formatted start date", () => {
    mockFetch(successQuestionsResponse);
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    // The formatted week date appears (never the raw weekId or ISO string).
    const label = screen.getByText(new RegExp(FORMATTED_WEEK_DATE));
    expect(label).toBeInTheDocument();
    // And it reads like a "week" label (e.g. "Questions for the week of ...").
    expect(label.textContent).toMatch(/week/i);
  });

  it("omits the week label when no start date is available (no 'Invalid Date')", () => {
    mockFetch(successQuestionsResponse);
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt=""
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    // No "Questions for the week of …" label and no broken date rendered.
    expect(screen.queryByText(/week of/i)).toBeNull();
    expect(screen.queryByText(/invalid date/i)).toBeNull();
    expect(screen.queryByText(new RegExp(FORMATTED_WEEK_DATE))).toBeNull();
  });

  it("renders a single 'Approve & open week' button", () => {
    mockFetch(successQuestionsResponse);
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    expect(
      screen.getByRole("button", { name: APPROVE_BUTTON_LABEL }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// edit + save flow
// ---------------------------------------------------------------------------

describe("AdminQuestionReview: save edit", () => {
  it("POSTs { action: 'edit', questionId, text } when the user edits and saves a question", async () => {
    const fetchMock = mockFetch(successQuestionsResponse);
    const user = userEvent.setup();
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    const firstQuestion = DRAFT_QUESTIONS[0];
    const input = screen.getByDisplayValue(firstQuestion.text);

    // Clear and type new text.
    await user.clear(input);
    await user.type(input, "My edited question text?");

    // Click the Save button for the first question.
    const saveButtons = screen.getAllByRole("button", { name: SAVE_BUTTON_LABEL });
    await user.click(saveButtons[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(QUESTIONS_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.action).toBe("edit");
    expect(body.questionId).toBe(firstQuestion.id);
    expect(body.text).toBe("My edited question text?");
  });

  it("calls router.refresh() after a successful save", async () => {
    mockFetch(successQuestionsResponse);
    const user = userEvent.setup();
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    const input = screen.getByDisplayValue(DRAFT_QUESTIONS[0].text);
    await user.clear(input);
    await user.type(input, "Updated text");

    const saveButtons = screen.getAllByRole("button", { name: SAVE_BUTTON_LABEL });
    await user.click(saveButtons[0]);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an error alert and does not throw when the save response is not ok", async () => {
    mockFetch(() => failureResponse("nope"));
    const user = userEvent.setup();
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    const input = screen.getByDisplayValue(DRAFT_QUESTIONS[0].text);
    await user.clear(input);
    await user.type(input, "Bad edit");

    const saveButtons = screen.getAllByRole("button", { name: SAVE_BUTTON_LABEL });
    await user.click(saveButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// regenerate flow
// ---------------------------------------------------------------------------

describe("AdminQuestionReview: regenerate", () => {
  it("POSTs { action: 'regenerate', questionId } when Regenerate is clicked", async () => {
    const fetchMock = mockFetch(successQuestionsResponse);
    const user = userEvent.setup();
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    const regenerateButtons = screen.getAllByRole("button", {
      name: REGENERATE_BUTTON_LABEL,
    });
    // Click the second question's Regenerate button to verify questionId routing.
    await user.click(regenerateButtons[1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(QUESTIONS_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.action).toBe("regenerate");
    expect(body.questionId).toBe(DRAFT_QUESTIONS[1].id);
    // text must NOT be present (or undefined) for a regenerate action.
    expect(body.text).toBeUndefined();
  });

  it("calls router.refresh() after a successful regenerate", async () => {
    mockFetch(successQuestionsResponse);
    const user = userEvent.setup();
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    const regenerateButtons = screen.getAllByRole("button", {
      name: REGENERATE_BUTTON_LABEL,
    });
    await user.click(regenerateButtons[0]);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an error alert and does not throw when the regenerate response is not ok", async () => {
    mockFetch(() => failureResponse("nope"));
    const user = userEvent.setup();
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    const regenerateButtons = screen.getAllByRole("button", {
      name: REGENERATE_BUTTON_LABEL,
    });
    await user.click(regenerateButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// approve flow
// ---------------------------------------------------------------------------

describe("AdminQuestionReview: approve", () => {
  it("POSTs { weekId } to /api/admin/week/approve when 'Approve & open week' is clicked", async () => {
    const fetchMock = mockFetch(successApproveResponse);
    const user = userEvent.setup();
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    await user.click(screen.getByRole("button", { name: APPROVE_BUTTON_LABEL }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(APPROVE_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.weekId).toBe(WEEK_ID);
  });

  it("calls router.refresh() after a successful approval", async () => {
    mockFetch(successApproveResponse);
    const user = userEvent.setup();
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    await user.click(screen.getByRole("button", { name: APPROVE_BUTTON_LABEL }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an error alert and does not throw when the approve response is not ok", async () => {
    mockFetch(() => failureResponse("nope"));
    const user = userEvent.setup();
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={NO_SUGGESTIONS}
      />,
    );

    await user.click(screen.getByRole("button", { name: APPROVE_BUTTON_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// per-action spinner while in flight + success toast (new UX feature)
// ---------------------------------------------------------------------------

describe("AdminQuestionReview: in-flight spinner and toasts", () => {
  it("shows a spinner on the Save button only while its save is pending, and toasts on success", async () => {
    const { resolve } = createDeferredFetch(successQuestionsResult);
    const user = userEvent.setup();
    renderWithToasts();

    const saveButtons = screen.getAllByRole("button", { name: SAVE_BUTTON_LABEL });
    await user.click(saveButtons[FIRST_QUESTION_INDEX]);

    // Exactly one spinner, on the first Save button.
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: SAVE_BUTTON_LABEL })[
          FIRST_QUESTION_INDEX
        ],
      ).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getAllByTestId(SPINNER_TEST_ID)).toHaveLength(EXPECTED_ONE_SPINNER);
    // The Regenerate / Approve buttons are NOT spinning meanwhile.
    expect(
      screen.getAllByRole("button", { name: REGENERATE_BUTTON_LABEL })[
        FIRST_QUESTION_INDEX
      ],
    ).not.toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: APPROVE_BUTTON_LABEL }),
    ).not.toHaveAttribute("aria-busy", "true");

    resolve();

    await waitFor(() => {
      expect(successToast()).toBeInTheDocument();
    });
    expect(successToast()).toHaveAttribute("data-variant", "success");
  });

  it("shows a spinner on the Regenerate button only while pending, and toasts on success", async () => {
    const { resolve } = createDeferredFetch(successQuestionsResult);
    const user = userEvent.setup();
    renderWithToasts();

    const regenerateButtons = screen.getAllByRole("button", {
      name: REGENERATE_BUTTON_LABEL,
    });
    await user.click(regenerateButtons[FIRST_QUESTION_INDEX]);

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: REGENERATE_BUTTON_LABEL })[
          FIRST_QUESTION_INDEX
        ],
      ).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getAllByTestId(SPINNER_TEST_ID)).toHaveLength(EXPECTED_ONE_SPINNER);
    expect(
      screen.getAllByRole("button", { name: SAVE_BUTTON_LABEL })[
        FIRST_QUESTION_INDEX
      ],
    ).not.toHaveAttribute("aria-busy", "true");

    resolve();

    await waitFor(() => {
      expect(successToast()).toHaveAttribute("data-variant", "success");
    });
  });

  it("shows a spinner on the Approve button only while pending, and toasts on success", async () => {
    const { resolve } = createDeferredFetch(successApproveResult);
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: APPROVE_BUTTON_LABEL }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: APPROVE_BUTTON_LABEL }),
      ).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getAllByTestId(SPINNER_TEST_ID)).toHaveLength(EXPECTED_ONE_SPINNER);
    // No Save button is spinning meanwhile.
    for (const saveButton of screen.getAllByRole("button", { name: SAVE_BUTTON_LABEL })) {
      expect(saveButton).not.toHaveAttribute("aria-busy", "true");
    }

    resolve();

    await waitFor(() => {
      expect(successToast()).toHaveAttribute("data-variant", "success");
    });
  });
});

// ---------------------------------------------------------------------------
// suggestions panel (question-suggestions slice 2 — DISPLAY-ONLY)
// ---------------------------------------------------------------------------
//
// Contract for the code-writer:
//   - AdminQuestionReview gains a REQUIRED prop:
//       suggestions: QuestionSuggestion[]
//   - It renders a suggestions panel showing, for each suggestion, its `text`
//     and its `suggestedByName`.
//   - The panel MUST render suggestions in the EXACT ORDER of the prop array
//     (the service already sorts newest-first; the panel does NOT re-sort).
//   - When `suggestions` is empty, the panel shows an empty state (copy
//     matching /no suggestions/i) and no suggestion rows.
//   - This slice is DISPLAY-ONLY: the panel renders NO Use / Discard action
//     buttons (those arrive in slices 03/04).
//
// Copy assertions are resilient (substring / case-insensitive) but pin the
// presence of each text + name and their relative ordering.

const SUGGESTIONS_TWO: QuestionSuggestion[] = [
  {
    id: "sug-new",
    text: "What is the best advice you ever got?",
    suggestedByName: "Ada Lovelace",
    createdAt: "2026-07-02T09:30:00.000Z",
  },
  {
    id: "sug-old",
    text: "What was your very first job?",
    suggestedByName: "Bob Bobson",
    createdAt: "2026-07-01T08:00:00.000Z",
  },
];

const EMPTY_SUGGESTIONS_PATTERN = /no suggestions/i;

describe("AdminQuestionReview: suggestions panel (display-only)", () => {
  it("renders each suggestion's text and suggestedByName", () => {
    mockFetch(successQuestionsResponse);
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={SUGGESTIONS_TWO}
      />,
    );

    for (const suggestion of SUGGESTIONS_TWO) {
      expect(screen.getByText(suggestion.text)).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(suggestion.suggestedByName)),
      ).toBeInTheDocument();
    }
  });

  it("renders suggestions in the ORDER GIVEN (does not re-sort)", () => {
    mockFetch(successQuestionsResponse);
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={SUGGESTIONS_TWO}
      />,
    );

    const firstText = screen.getByText(SUGGESTIONS_TWO[0].text);
    const secondText = screen.getByText(SUGGESTIONS_TWO[1].text);

    // The prop's [0] (newest) must appear BEFORE [1] in DOM order.
    expect(
      firstText.compareDocumentPosition(secondText) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows an empty state when suggestions is []", () => {
    mockFetch(successQuestionsResponse);
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={[]}
      />,
    );

    expect(screen.getByText(EMPTY_SUGGESTIONS_PATTERN)).toBeInTheDocument();
    // No seeded suggestion rows rendered.
    expect(screen.queryByText(SUGGESTIONS_TWO[0].text)).toBeNull();
  });

});

// ---------------------------------------------------------------------------
// suggestions panel — Use / Discard controls (slices 03 + 04)
// ---------------------------------------------------------------------------
//
// Contract for the code-writer:
//   - Each suggestion row renders a slot <select> (role "combobox") whose
//     options are labeled `Slot 1 — <question text>` … `Slot N — …` derived
//     from the `questions` prop (WEEKLY_QUESTION_COUNT options). Each option's
//     VALUE is the corresponding question's id.
//   - Each row also renders a **Use** button and a **Discard** button.
//   - Selecting a slot + clicking that row's Use POSTs to
//     `/api/admin/suggestions` with
//       { action: "use", suggestionId, draftQuestionId } (the selected
//     question's id), then calls router.refresh() on success.
//   - Clicking a row's Discard POSTs { action: "remove", suggestionId } and
//     refreshes. NO confirmation dialog appears.
//   - Success handling mirrors the existing edit/regenerate flow (postAndRefresh).
//   - Row queries are SCOPED (via `within`) because two suggestions produce two
//     Use/Discard buttons.

const SUGGESTIONS_ENDPOINT = "/api/admin/suggestions";
const USE_BUTTON_LABEL = "Use";
const DISCARD_BUTTON_LABEL = "Discard";

/**
 * Resolves the row (list item / container) enclosing a given suggestion's
 * text so queries can be scoped to a single suggestion.
 */
const rowFor = (suggestion: QuestionSuggestion): HTMLElement => {
  const textNode = screen.getByText(suggestion.text);
  const row = textNode.closest("li") ?? textNode.parentElement;
  if (!row) throw new Error(`No row found for suggestion "${suggestion.id}"`);
  return row as HTMLElement;
};

describe("AdminQuestionReview: suggestions panel Use/Discard controls", () => {
  it("renders a slot select, a Use button and a Discard button per suggestion", () => {
    mockFetch(successQuestionsResponse);
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={SUGGESTIONS_TWO}
      />,
    );

    for (const suggestion of SUGGESTIONS_TWO) {
      const row = within(rowFor(suggestion));
      expect(row.getByRole("combobox")).toBeInTheDocument();
      expect(
        row.getByRole("button", { name: USE_BUTTON_LABEL }),
      ).toBeInTheDocument();
      expect(
        row.getByRole("button", { name: DISCARD_BUTTON_LABEL }),
      ).toBeInTheDocument();
    }
  });

  it("labels each slot option `Slot N — <question text>` (one option per draft question)", () => {
    mockFetch(successQuestionsResponse);
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={SUGGESTIONS_TWO}
      />,
    );

    const row = within(rowFor(SUGGESTIONS_TWO[0]));
    const options = row.getAllByRole("option");
    expect(options).toHaveLength(WEEKLY_QUESTION_COUNT);

    DRAFT_QUESTIONS.forEach((question, i) => {
      expect(options[i].textContent).toContain(`Slot ${i + 1}`);
      expect(options[i].textContent).toContain(question.text);
    });
  });

  it("POSTs { action: 'use', suggestionId, draftQuestionId } for the selected slot and refreshes", async () => {
    const fetchMock = mockFetch(successQuestionsResponse);
    const user = userEvent.setup();
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={SUGGESTIONS_TWO}
      />,
    );

    const suggestion = SUGGESTIONS_TWO[0];
    const targetQuestion = DRAFT_QUESTIONS[1]; // pick the 2nd slot
    const row = within(rowFor(suggestion));

    // Select the target slot by its option value (the question id).
    await user.selectOptions(row.getByRole("combobox"), targetQuestion.id);
    await user.click(row.getByRole("button", { name: USE_BUTTON_LABEL }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SUGGESTIONS_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.action).toBe("use");
    expect(body.suggestionId).toBe(suggestion.id);
    expect(body.draftQuestionId).toBe(targetQuestion.id);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("POSTs { action: 'remove', suggestionId } when Discard is clicked, with no confirmation dialog, and refreshes", async () => {
    const fetchMock = mockFetch(successApproveResponse);
    const user = userEvent.setup();
    render(
      <AdminQuestionReview
        weekId={WEEK_ID}
        weekStartsAt={WEEK_STARTS_AT}
        questions={DRAFT_QUESTIONS}
        suggestions={SUGGESTIONS_TWO}
      />,
    );

    const suggestion = SUGGESTIONS_TWO[1];
    const row = within(rowFor(suggestion));

    await user.click(row.getByRole("button", { name: DISCARD_BUTTON_LABEL }));

    // No confirmation dialog is presented before the request fires.
    expect(screen.queryByRole("dialog")).toBeNull();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SUGGESTIONS_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.action).toBe("remove");
    expect(body.suggestionId).toBe(suggestion.id);
    // No draftQuestionId is sent for a discard.
    expect(body.draftQuestionId).toBeUndefined();

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});
