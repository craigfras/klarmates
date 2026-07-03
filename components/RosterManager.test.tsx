/**
 * RosterManager component tests.
 *
 * ---------------------------------------------------------------------------
 * Contract decisions documented for the code-writer
 * ---------------------------------------------------------------------------
 * Props:
 *   { players: Player[]; absentPlayerIds: string[]; weekId: string }
 *   - players:          Full roster (active and inactive) to display.
 *   - absentPlayerIds:  Ids of players currently flagged absent for weekId.
 *   - weekId:           The upcoming week id; sent with absence toggling.
 *
 * Endpoints:
 *   POST /api/admin/roster        (upsert + deactivate)
 *   POST /api/admin/week/absences (set absence flags)
 *
 * Accessible structure the implementation MUST match:
 *   - Each player row is rendered inside an element with role="row" and
 *     aria-label equal to the player's name (e.g. aria-label="Alice").
 *     Tests scope within-row queries using within(row).
 *   - Within each row the following controls exist:
 *       - Name text input:     aria-label="Name"
 *       - Email text input:    aria-label="Email"
 *       - Slack id text input: aria-label="Slack id"
 *       - Admin checkbox:      aria-label="Admin"   (checked = isAdmin)
 *       - Active checkbox:     aria-label="Active"  (checked = active)
 *       - Absent checkbox:     aria-label="Absent"  (checked = id in absentPlayerIds)
 *       - Save button:         accessible name "Save"
 *       - For active players:  Remove button (accessible name "Remove"), NO Reactivate button
 *       - For inactive players: Reactivate button (accessible name "Reactivate"), NO Remove button
 *   - An "Add player" section contains:
 *       - Name text input:   aria-label="New player name"
 *       - Email text input:  aria-label="New player email"
 *       - A button with accessible name "Add player"
 *
 * On success: router.refresh() is called.
 * On failure: an error appears via role="alert", router.refresh() is NOT called.
 *
 * Props-sync (bug fix):
 *   When the `players` or `absentPlayerIds` props change (e.g. after
 *   router.refresh() delivers new server data via rerender), the rendered
 *   checkboxes and fields must re-sync to the new prop values rather than
 *   keeping stale local state.
 * ---------------------------------------------------------------------------
 */

import { render, screen, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/lib/types";
import { RosterManager } from "@/components/RosterManager";
import { ToastProvider, ToastViewport } from "@/components/Toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEK_ID = "week-2026-26";
const ROSTER_ENDPOINT = "/api/admin/roster";
const ABSENCES_ENDPOINT = "/api/admin/week/absences";
const SPINNER_TEST_ID = "spinner";
const EXPECTED_ONE_SPINNER = 1;
const ERROR_VARIANT = "error";
const ABSENCE_FAILURE_MESSAGE = "week already open";

const SAVE_BUTTON_LABEL = "Save";
const REMOVE_BUTTON_LABEL = "Remove";
const REACTIVATE_BUTTON_LABEL = "Reactivate";
const ADD_PLAYER_BUTTON_LABEL = "Add player";

/** The Sync-Slack-ids button name is matched case-insensitively on /slack/i. */
const SYNC_SLACK_BUTTON_NAME = /slack/i;
/** The resolve_slack action string expected in the POST body. */
const RESOLVE_SLACK_ACTION = "resolve_slack";
const SUCCESS_VARIANT = "success";

const NAME_INPUT_LABEL = "Name";
const EMAIL_INPUT_LABEL = "Email";
const SLACK_INPUT_LABEL = "Slack id";
const ADMIN_CHECKBOX_LABEL = "Admin";
const ACTIVE_CHECKBOX_LABEL = "Active";
const ABSENT_CHECKBOX_LABEL = "Absent";

const NEW_PLAYER_NAME_LABEL = "New player name";
const NEW_PLAYER_EMAIL_LABEL = "New player email";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  id: "player-1",
  name: "Alice",
  email: "alice@example.com",
  slackUserId: "U001",
  isAdmin: false,
  active: true,
  ...overrides,
});

const PLAYER_ALICE = makePlayer({ id: "player-1", name: "Alice", email: "alice@example.com", slackUserId: "U001" });
const PLAYER_BOB = makePlayer({ id: "player-2", name: "Bob", email: "bob@example.com", slackUserId: "U002", isAdmin: true });
const PLAYER_CAROL_INACTIVE = makePlayer({ id: "player-3", name: "Carol", email: "carol@example.com", slackUserId: "U003", active: false });

const TWO_PLAYERS: Player[] = [PLAYER_ALICE, PLAYER_BOB];

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

type MockResponseInit = { ok: boolean; json: () => Promise<unknown> };

const mockFetch = (impl: () => Promise<MockResponseInit>) => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<MockResponseInit>>(impl);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const successRosterResponse = (players: Player[] = TWO_PLAYERS): () => Promise<MockResponseInit> =>
  () => Promise.resolve({
    ok: true,
    json: async () => ({ players }),
  });

const successAbsencesResponse = (): Promise<MockResponseInit> =>
  Promise.resolve({
    ok: true,
    json: async () => ({ ok: true }),
  });

const failureResponse = (errorMessage = "something went wrong"): () => Promise<MockResponseInit> =>
  () => Promise.resolve({
    ok: false,
    json: async () => ({ error: errorMessage }),
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the row element for the given player name.
 * Relies on role="row" with aria-label matching the player's name.
 */
const getPlayerRow = (name: string): HTMLElement =>
  screen.getByRole("row", { name });

/**
 * Renders the component inside the toast context so success toasts can be
 * asserted via role="status" inside the polite live region.
 */
const renderWithToasts = (
  players: Player[],
  absentPlayerIds: string[] = [],
  weekId: string = WEEK_ID,
) =>
  render(
    <ToastProvider>
      <RosterManager players={players} absentPlayerIds={absentPlayerIds} weekId={weekId} />
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

const successRosterResult: MockResponseInit = {
  ok: true,
  json: async () => ({ players: TWO_PLAYERS }),
};

const successToast = () => within(screen.getByRole("region")).getByRole("status");
const anyToast = () => within(screen.getByRole("region")).getByRole("status");

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

describe("RosterManager: rendering", () => {
  it("renders one row per player", () => {
    mockFetch(successRosterResponse());
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const rows = screen.getAllByRole("row");
    // Exactly one row per player (no header row counted in).
    expect(rows).toHaveLength(TWO_PLAYERS.length);
  });

  it("pre-fills the Name input with the player's name", () => {
    mockFetch(successRosterResponse());
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const nameInput = within(aliceRow).getByRole("textbox", { name: NAME_INPUT_LABEL });
    expect((nameInput as HTMLInputElement).value).toBe("Alice");
  });

  it("pre-fills the Email input with the player's email", () => {
    mockFetch(successRosterResponse());
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const emailInput = within(aliceRow).getByRole("textbox", { name: EMAIL_INPUT_LABEL });
    expect((emailInput as HTMLInputElement).value).toBe("alice@example.com");
  });

  it("pre-fills the Slack id input with the player's slackUserId", () => {
    mockFetch(successRosterResponse());
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const slackInput = within(aliceRow).getByRole("textbox", { name: SLACK_INPUT_LABEL });
    expect((slackInput as HTMLInputElement).value).toBe("U001");
  });

  it("renders the Admin checkbox checked for an admin player, unchecked for a non-admin", () => {
    mockFetch(successRosterResponse());
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const aliceAdminBox = within(aliceRow).getByRole("checkbox", { name: ADMIN_CHECKBOX_LABEL });
    expect((aliceAdminBox as HTMLInputElement).checked).toBe(false);

    const bobRow = getPlayerRow("Bob");
    const bobAdminBox = within(bobRow).getByRole("checkbox", { name: ADMIN_CHECKBOX_LABEL });
    expect((bobAdminBox as HTMLInputElement).checked).toBe(true);
  });

  it("renders the Active checkbox checked for an active player", () => {
    mockFetch(successRosterResponse());
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const activeBox = within(aliceRow).getByRole("checkbox", { name: ACTIVE_CHECKBOX_LABEL });
    expect((activeBox as HTMLInputElement).checked).toBe(true);
  });

  it("renders the Absent checkbox checked for players in absentPlayerIds, unchecked otherwise", () => {
    mockFetch(successRosterResponse());
    render(
      <RosterManager
        players={TWO_PLAYERS}
        absentPlayerIds={[PLAYER_ALICE.id]}
        weekId={WEEK_ID}
      />,
    );

    const aliceRow = getPlayerRow("Alice");
    const aliceAbsent = within(aliceRow).getByRole("checkbox", { name: ABSENT_CHECKBOX_LABEL });
    expect((aliceAbsent as HTMLInputElement).checked).toBe(true);

    const bobRow = getPlayerRow("Bob");
    const bobAbsent = within(bobRow).getByRole("checkbox", { name: ABSENT_CHECKBOX_LABEL });
    expect((bobAbsent as HTMLInputElement).checked).toBe(false);
  });

  it("renders Save and Remove buttons for each player row", () => {
    mockFetch(successRosterResponse());
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const saveButtons = screen.getAllByRole("button", { name: SAVE_BUTTON_LABEL });
    expect(saveButtons).toHaveLength(TWO_PLAYERS.length);

    const removeButtons = screen.getAllByRole("button", { name: REMOVE_BUTTON_LABEL });
    expect(removeButtons).toHaveLength(TWO_PLAYERS.length);
  });

  it("renders the Add player section with name/email inputs and Add player button", () => {
    mockFetch(successRosterResponse());
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    expect(screen.getByRole("textbox", { name: NEW_PLAYER_NAME_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: NEW_PLAYER_EMAIL_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADD_PLAYER_BUTTON_LABEL })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Save (upsert) flow
// ---------------------------------------------------------------------------

describe("RosterManager: Save button (upsert)", () => {
  it("POSTs { action: 'upsert', player } to /api/admin/roster with the edited name", async () => {
    const fetchMock = mockFetch(successRosterResponse());
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const nameInput = within(aliceRow).getByRole("textbox", { name: NAME_INPUT_LABEL });

    await user.clear(nameInput);
    await user.type(nameInput, "Alice Updated");

    const saveButton = within(aliceRow).getByRole("button", { name: SAVE_BUTTON_LABEL });
    await user.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ROSTER_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.action).toBe("upsert");
    expect(body.player.id).toBe(PLAYER_ALICE.id);
    expect(body.player.name).toBe("Alice Updated");
  });

  it("calls router.refresh() after a successful save", async () => {
    mockFetch(successRosterResponse());
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const saveButton = within(aliceRow).getByRole("button", { name: SAVE_BUTTON_LABEL });
    await user.click(saveButton);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an error alert and does not throw when the save response is not ok", async () => {
    mockFetch(failureResponse("update failed"));
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const saveButton = within(aliceRow).getByRole("button", { name: SAVE_BUTTON_LABEL });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("includes the edited email in the upsert player body", async () => {
    const fetchMock = mockFetch(successRosterResponse());
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const emailInput = within(aliceRow).getByRole("textbox", { name: EMAIL_INPUT_LABEL });

    await user.clear(emailInput);
    await user.type(emailInput, "alice_new@example.com");

    const saveButton = within(aliceRow).getByRole("button", { name: SAVE_BUTTON_LABEL });
    await user.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.action).toBe("upsert");
    expect(body.player.email).toBe("alice_new@example.com");
  });
});

// ---------------------------------------------------------------------------
// Remove (deactivate) flow
// ---------------------------------------------------------------------------

describe("RosterManager: Remove button (deactivate)", () => {
  it("POSTs { action: 'deactivate', playerId } to /api/admin/roster", async () => {
    const fetchMock = mockFetch(successRosterResponse());
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const removeButton = within(aliceRow).getByRole("button", { name: REMOVE_BUTTON_LABEL });
    await user.click(removeButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ROSTER_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.action).toBe("deactivate");
    expect(body.playerId).toBe(PLAYER_ALICE.id);
  });

  it("calls router.refresh() after a successful remove", async () => {
    mockFetch(successRosterResponse());
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const removeButton = within(aliceRow).getByRole("button", { name: REMOVE_BUTTON_LABEL });
    await user.click(removeButton);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an error alert and does not throw when the remove response is not ok", async () => {
    mockFetch(failureResponse("cannot deactivate"));
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const removeButton = within(aliceRow).getByRole("button", { name: REMOVE_BUTTON_LABEL });
    await user.click(removeButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Absent checkbox toggle
// ---------------------------------------------------------------------------

describe("RosterManager: Absent checkbox toggle", () => {
  it("POSTs to /api/admin/week/absences with weekId and an array containing the toggled id when checking a previously-unchecked Absent box", async () => {
    // Alice starts NOT absent; Bob starts absent.
    const fetchMock = mockFetch(() => successAbsencesResponse());
    const user = userEvent.setup();
    render(
      <RosterManager
        players={TWO_PLAYERS}
        absentPlayerIds={[PLAYER_BOB.id]}
        weekId={WEEK_ID}
      />,
    );

    // Check Alice's Absent box (she was not absent).
    const aliceRow = getPlayerRow("Alice");
    const aliceAbsent = within(aliceRow).getByRole("checkbox", { name: ABSENT_CHECKBOX_LABEL });
    await user.click(aliceAbsent);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ABSENCES_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.weekId).toBe(WEEK_ID);
    // Alice's id should now be in the list (added); Bob remains.
    expect(body.absentPlayerIds).toContain(PLAYER_ALICE.id);
    expect(body.absentPlayerIds).toContain(PLAYER_BOB.id);
  });

  it("POSTs to /api/admin/week/absences with an array excluding the id when unchecking a previously-checked Absent box", async () => {
    // Bob starts absent; unchecking his box should remove him.
    const fetchMock = mockFetch(() => successAbsencesResponse());
    const user = userEvent.setup();
    render(
      <RosterManager
        players={TWO_PLAYERS}
        absentPlayerIds={[PLAYER_BOB.id]}
        weekId={WEEK_ID}
      />,
    );

    const bobRow = getPlayerRow("Bob");
    const bobAbsent = within(bobRow).getByRole("checkbox", { name: ABSENT_CHECKBOX_LABEL });
    await user.click(bobAbsent);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.weekId).toBe(WEEK_ID);
    // Bob's id should have been removed.
    expect(body.absentPlayerIds).not.toContain(PLAYER_BOB.id);
  });

  it("calls router.refresh() after a successful absence toggle", async () => {
    mockFetch(() => successAbsencesResponse());
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const aliceAbsent = within(aliceRow).getByRole("checkbox", { name: ABSENT_CHECKBOX_LABEL });
    await user.click(aliceAbsent);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an error alert and does not call router.refresh() when the absence POST fails", async () => {
    mockFetch(failureResponse("week already open"));
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRow = getPlayerRow("Alice");
    const aliceAbsent = within(aliceRow).getByRole("checkbox", { name: ABSENT_CHECKBOX_LABEL });
    await user.click(aliceAbsent);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Add player flow
// ---------------------------------------------------------------------------

describe("RosterManager: Add player", () => {
  it("POSTs { action: 'upsert', player } to /api/admin/roster with the typed name and email", async () => {
    const fetchMock = mockFetch(successRosterResponse());
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const newNameInput = screen.getByRole("textbox", { name: NEW_PLAYER_NAME_LABEL });
    const newEmailInput = screen.getByRole("textbox", { name: NEW_PLAYER_EMAIL_LABEL });
    const addButton = screen.getByRole("button", { name: ADD_PLAYER_BUTTON_LABEL });

    await user.type(newNameInput, "Charlie");
    await user.type(newEmailInput, "charlie@example.com");
    await user.click(addButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ROSTER_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.action).toBe("upsert");
    expect(body.player.name).toBe("Charlie");
    expect(body.player.email).toBe("charlie@example.com");
    // The component generates an id — we assert it is a non-empty string
    // without caring about its exact value.
    expect(typeof body.player.id).toBe("string");
    expect(body.player.id.length).toBeGreaterThan(0);
  });

  it("calls router.refresh() after a successful add-player action", async () => {
    mockFetch(successRosterResponse());
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const newNameInput = screen.getByRole("textbox", { name: NEW_PLAYER_NAME_LABEL });
    await user.type(newNameInput, "Charlie");

    const addButton = screen.getByRole("button", { name: ADD_PLAYER_BUTTON_LABEL });
    await user.click(addButton);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an error alert and does not throw when the add-player response is not ok", async () => {
    mockFetch(failureResponse("validation error"));
    const user = userEvent.setup();
    render(
      <RosterManager players={TWO_PLAYERS} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const newNameInput = screen.getByRole("textbox", { name: NEW_PLAYER_NAME_LABEL });
    await user.type(newNameInput, "Bad Player");

    const addButton = screen.getByRole("button", { name: ADD_PLAYER_BUTTON_LABEL });
    await user.click(addButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Props-sync regression (bug: local state shadows updated props)
// ---------------------------------------------------------------------------

describe("RosterManager: props-sync regression", () => {
  /**
   * Regression for the bug where seeding local state only on mount means the
   * component ignores updated props delivered by router.refresh(). After a
   * rerender with new prop values the UI must reflect the new data.
   */
  it("syncs the Active checkbox when the players prop is rerendered with active: false (regression)", () => {
    // Arrange: render Alice as active.
    mockFetch(successRosterResponse());
    const aliceActive = makePlayer({ id: "player-1", name: "Alice", active: true });
    const { rerender } = render(
      <RosterManager players={[aliceActive]} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRowBefore = getPlayerRow("Alice");
    const activeBoxBefore = within(aliceRowBefore).getByRole("checkbox", { name: ACTIVE_CHECKBOX_LABEL });
    expect((activeBoxBefore as HTMLInputElement).checked).toBe(true);

    // Act: rerender with the same player but active: false (simulates router.refresh() delivering updated data).
    const aliceInactive = makePlayer({ id: "player-1", name: "Alice", active: false });
    act(() => {
      rerender(
        <RosterManager players={[aliceInactive]} absentPlayerIds={[]} weekId={WEEK_ID} />,
      );
    });

    // Assert: the Active checkbox must now be UNCHECKED.
    // Currently FAILS because useState seeds only on mount and ignores updated props.
    const aliceRowAfter = getPlayerRow("Alice");
    const activeBoxAfter = within(aliceRowAfter).getByRole("checkbox", { name: ACTIVE_CHECKBOX_LABEL });
    expect((activeBoxAfter as HTMLInputElement).checked).toBe(false);
  });

  it("syncs the Absent checkbox when absentPlayerIds prop is rerendered with the player's id added (regression)", () => {
    // Arrange: render Alice as NOT absent.
    mockFetch(successRosterResponse());
    const alicePlayer = makePlayer({ id: "player-1", name: "Alice" });
    const { rerender } = render(
      <RosterManager players={[alicePlayer]} absentPlayerIds={[]} weekId={WEEK_ID} />,
    );

    const aliceRowBefore = getPlayerRow("Alice");
    const absentBoxBefore = within(aliceRowBefore).getByRole("checkbox", { name: ABSENT_CHECKBOX_LABEL });
    expect((absentBoxBefore as HTMLInputElement).checked).toBe(false);

    // Act: rerender with Alice's id now in absentPlayerIds (simulates router.refresh() data).
    act(() => {
      rerender(
        <RosterManager players={[alicePlayer]} absentPlayerIds={[alicePlayer.id]} weekId={WEEK_ID} />,
      );
    });

    // Assert: the Absent checkbox must now be CHECKED.
    // Currently FAILS because useState seeds only on mount and ignores updated props.
    const aliceRowAfter = getPlayerRow("Alice");
    const absentBoxAfter = within(aliceRowAfter).getByRole("checkbox", { name: ABSENT_CHECKBOX_LABEL });
    expect((absentBoxAfter as HTMLInputElement).checked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inactive player: Reactivate button (UX change)
// ---------------------------------------------------------------------------

describe("RosterManager: inactive player shows Reactivate instead of Remove", () => {
  it("shows a Reactivate button and NO Remove button for an inactive player", () => {
    // Arrange: one active player and one inactive player.
    mockFetch(successRosterResponse());
    render(
      <RosterManager
        players={[PLAYER_ALICE, PLAYER_CAROL_INACTIVE]}
        absentPlayerIds={[]}
        weekId={WEEK_ID}
      />,
    );

    // Assert: Carol's row has Reactivate, not Remove.
    const carolRow = getPlayerRow("Carol");
    expect(within(carolRow).getByRole("button", { name: REACTIVATE_BUTTON_LABEL })).toBeInTheDocument();
    expect(within(carolRow).queryByRole("button", { name: REMOVE_BUTTON_LABEL })).not.toBeInTheDocument();
  });

  it("shows a Remove button and NO Reactivate button for an active player", () => {
    mockFetch(successRosterResponse());
    render(
      <RosterManager
        players={[PLAYER_ALICE, PLAYER_CAROL_INACTIVE]}
        absentPlayerIds={[]}
        weekId={WEEK_ID}
      />,
    );

    // Assert: Alice's row has Remove, not Reactivate.
    const aliceRow = getPlayerRow("Alice");
    expect(within(aliceRow).getByRole("button", { name: REMOVE_BUTTON_LABEL })).toBeInTheDocument();
    expect(within(aliceRow).queryByRole("button", { name: REACTIVATE_BUTTON_LABEL })).not.toBeInTheDocument();
  });

  it("POSTs { action: 'upsert', player: { ...player, active: true } } when Reactivate is clicked", async () => {
    const fetchMock = mockFetch(successRosterResponse());
    const user = userEvent.setup();
    render(
      <RosterManager
        players={[PLAYER_CAROL_INACTIVE]}
        absentPlayerIds={[]}
        weekId={WEEK_ID}
      />,
    );

    const carolRow = getPlayerRow("Carol");
    const reactivateButton = within(carolRow).getByRole("button", { name: REACTIVATE_BUTTON_LABEL });
    await user.click(reactivateButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ROSTER_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.action).toBe("upsert");
    expect(body.player.id).toBe(PLAYER_CAROL_INACTIVE.id);
    // The reactivated player must carry active: true.
    expect(body.player.active).toBe(true);
  });

  it("calls router.refresh() after a successful Reactivate", async () => {
    mockFetch(successRosterResponse());
    const user = userEvent.setup();
    render(
      <RosterManager
        players={[PLAYER_CAROL_INACTIVE]}
        absentPlayerIds={[]}
        weekId={WEEK_ID}
      />,
    );

    const carolRow = getPlayerRow("Carol");
    const reactivateButton = within(carolRow).getByRole("button", { name: REACTIVATE_BUTTON_LABEL });
    await user.click(reactivateButton);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an error alert and does not call router.refresh() when Reactivate POST fails", async () => {
    mockFetch(failureResponse("cannot reactivate"));
    const user = userEvent.setup();
    render(
      <RosterManager
        players={[PLAYER_CAROL_INACTIVE]}
        absentPlayerIds={[]}
        weekId={WEEK_ID}
      />,
    );

    const carolRow = getPlayerRow("Carol");
    const reactivateButton = within(carolRow).getByRole("button", { name: REACTIVATE_BUTTON_LABEL });
    await user.click(reactivateButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// per-action spinner while in flight + success toast (new UX feature)
// ---------------------------------------------------------------------------

describe("RosterManager: in-flight spinner and toasts", () => {
  it("shows a spinner on the Save button only while its save is pending, and toasts on success", async () => {
    const { resolve } = createDeferredFetch(successRosterResult);
    const user = userEvent.setup();
    renderWithToasts(TWO_PLAYERS);

    const aliceRow = getPlayerRow("Alice");
    const saveButton = within(aliceRow).getByRole("button", { name: SAVE_BUTTON_LABEL });
    await user.click(saveButton);

    // Exactly one spinner, on Alice's Save button.
    await waitFor(() => {
      expect(
        within(getPlayerRow("Alice")).getByRole("button", { name: SAVE_BUTTON_LABEL }),
      ).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getAllByTestId(SPINNER_TEST_ID)).toHaveLength(EXPECTED_ONE_SPINNER);
    // Bob's Save button is NOT spinning meanwhile.
    expect(
      within(getPlayerRow("Bob")).getByRole("button", { name: SAVE_BUTTON_LABEL }),
    ).not.toHaveAttribute("aria-busy", "true");

    resolve();

    await waitFor(() => {
      expect(successToast()).toHaveAttribute("data-variant", "success");
    });
  });

  it("shows a spinner on the Remove button while pending, and toasts on success", async () => {
    const { resolve } = createDeferredFetch(successRosterResult);
    const user = userEvent.setup();
    renderWithToasts(TWO_PLAYERS);

    const aliceRow = getPlayerRow("Alice");
    const removeButton = within(aliceRow).getByRole("button", { name: REMOVE_BUTTON_LABEL });
    await user.click(removeButton);

    await waitFor(() => {
      expect(
        within(getPlayerRow("Alice")).getByRole("button", { name: REMOVE_BUTTON_LABEL }),
      ).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getAllByTestId(SPINNER_TEST_ID)).toHaveLength(EXPECTED_ONE_SPINNER);

    resolve();

    await waitFor(() => {
      expect(successToast()).toHaveAttribute("data-variant", "success");
    });
  });

  it("shows a spinner on the Reactivate button while pending, and toasts on success", async () => {
    const { resolve } = createDeferredFetch(successRosterResult);
    const user = userEvent.setup();
    renderWithToasts([PLAYER_CAROL_INACTIVE]);

    const carolRow = getPlayerRow("Carol");
    const reactivateButton = within(carolRow).getByRole("button", { name: REACTIVATE_BUTTON_LABEL });
    await user.click(reactivateButton);

    await waitFor(() => {
      expect(
        within(getPlayerRow("Carol")).getByRole("button", { name: REACTIVATE_BUTTON_LABEL }),
      ).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getAllByTestId(SPINNER_TEST_ID)).toHaveLength(EXPECTED_ONE_SPINNER);

    resolve();

    await waitFor(() => {
      expect(successToast()).toHaveAttribute("data-variant", "success");
    });
  });

  it("shows a spinner on the Add player button while pending, and toasts on success", async () => {
    const { resolve } = createDeferredFetch(successRosterResult);
    const user = userEvent.setup();
    renderWithToasts(TWO_PLAYERS);

    await user.type(screen.getByRole("textbox", { name: NEW_PLAYER_NAME_LABEL }), "Charlie");
    const addButton = screen.getByRole("button", { name: ADD_PLAYER_BUTTON_LABEL });
    await user.click(addButton);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: ADD_PLAYER_BUTTON_LABEL }),
      ).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getAllByTestId(SPINNER_TEST_ID)).toHaveLength(EXPECTED_ONE_SPINNER);

    resolve();

    await waitFor(() => {
      expect(successToast()).toHaveAttribute("data-variant", "success");
    });
  });
});

// ---------------------------------------------------------------------------
// Absent-toggle optimistic rollback regression (bug: failed toggle not reverted)
// ---------------------------------------------------------------------------

describe("RosterManager: Absent toggle optimistic rollback regression", () => {
  /**
   * Regression for the bug where handleAbsentToggle calls setAbsentIds(next)
   * BEFORE the POST and never rolls back when the request fails. The checkbox
   * keeps the optimistic (wrong) value even though the server rejected it.
   * After a failed toggle the checkbox must return to its original state and
   * an error must be surfaced.
   */
  it("reverts a previously-unchecked Absent box back to unchecked when the absence POST fails (regression)", async () => {
    // Alice starts NOT absent.
    mockFetch(failureResponse(ABSENCE_FAILURE_MESSAGE));
    const user = userEvent.setup();
    renderWithToasts(TWO_PLAYERS, []);

    const aliceAbsent = within(getPlayerRow("Alice")).getByRole("checkbox", {
      name: ABSENT_CHECKBOX_LABEL,
    });
    expect((aliceAbsent as HTMLInputElement).checked).toBe(false);

    await user.click(aliceAbsent);

    // After the failed request settles the checkbox must be reverted to its
    // original UNCHECKED state (the optimistic change was rolled back).
    await waitFor(() => {
      const reverted = within(getPlayerRow("Alice")).getByRole("checkbox", {
        name: ABSENT_CHECKBOX_LABEL,
      });
      expect((reverted as HTMLInputElement).checked).toBe(false);
    });

    // refresh must not have run on failure (matches existing failure contract).
    expect(refresh).not.toHaveBeenCalled();

    // And an error is surfaced (inline alert + error toast).
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(anyToast()).toHaveAttribute("data-variant", ERROR_VARIANT);
  });

  it("reverts a previously-checked Absent box back to checked when the absence POST fails (regression)", async () => {
    // Bob starts absent.
    mockFetch(failureResponse(ABSENCE_FAILURE_MESSAGE));
    const user = userEvent.setup();
    renderWithToasts(TWO_PLAYERS, [PLAYER_BOB.id]);

    const bobAbsent = within(getPlayerRow("Bob")).getByRole("checkbox", {
      name: ABSENT_CHECKBOX_LABEL,
    });
    expect((bobAbsent as HTMLInputElement).checked).toBe(true);

    await user.click(bobAbsent);

    // After the failed request settles the checkbox must be reverted to its
    // original CHECKED state.
    await waitFor(() => {
      const reverted = within(getPlayerRow("Bob")).getByRole("checkbox", {
        name: ABSENT_CHECKBOX_LABEL,
      });
      expect((reverted as HTMLInputElement).checked).toBe(true);
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(anyToast()).toHaveAttribute("data-variant", ERROR_VARIANT);
  });
});

// ---------------------------------------------------------------------------
// Sync Slack IDs button (slice 12 cycle B)
// ---------------------------------------------------------------------------
//
// CONTRACT: RosterManager renders a button whose accessible name matches
// /slack/i. Clicking it POSTs { action: "resolve_slack" } to /api/admin/roster,
// shows the shared Button spinner (data-testid="spinner" + aria-busy) while the
// request is in flight, raises a success toast and calls router.refresh() on
// success. On a { ok: false } failure it surfaces an error toast and the button
// recovers (no longer disabled / aria-busy).
// ---------------------------------------------------------------------------

describe("RosterManager: Sync Slack IDs button", () => {
  it("renders a button whose name matches /slack/i", () => {
    mockFetch(successRosterResponse());
    renderWithToasts(TWO_PLAYERS);

    expect(
      screen.getByRole("button", { name: SYNC_SLACK_BUTTON_NAME }),
    ).toBeInTheDocument();
  });

  it("POSTs { action: 'resolve_slack' } to /api/admin/roster, spins while pending, then toasts success and refreshes", async () => {
    const { fetchMock, resolve } = createDeferredFetch(successRosterResult);
    const user = userEvent.setup();
    renderWithToasts(TWO_PLAYERS);

    const syncButton = screen.getByRole("button", { name: SYNC_SLACK_BUTTON_NAME });
    await user.click(syncButton);

    // --- POST shape: correct endpoint + resolve_slack action --------------
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ROSTER_ENDPOINT);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.action).toBe(RESOLVE_SLACK_ACTION);

    // --- In-flight: the shared spinner shows on the (busy, disabled) button -
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: SYNC_SLACK_BUTTON_NAME }),
      ).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getAllByTestId(SPINNER_TEST_ID)).toHaveLength(EXPECTED_ONE_SPINNER);
    expect(
      screen.getByRole("button", { name: SYNC_SLACK_BUTTON_NAME }),
    ).toBeDisabled();

    // --- On success: success toast + router.refresh() ---------------------
    resolve();
    await waitFor(() => {
      expect(successToast()).toHaveAttribute("data-variant", SUCCESS_VARIANT);
    });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces an error toast and recovers the button when the resolve_slack POST fails", async () => {
    mockFetch(failureResponse("slack backfill failed"));
    const user = userEvent.setup();
    renderWithToasts(TWO_PLAYERS);

    const syncButton = screen.getByRole("button", { name: SYNC_SLACK_BUTTON_NAME });
    await user.click(syncButton);

    // --- Error toast surfaced --------------------------------------------
    await waitFor(() => {
      expect(anyToast()).toHaveAttribute("data-variant", ERROR_VARIANT);
    });

    // --- Button recovers: not busy, not disabled, no leftover spinner -----
    const recovered = screen.getByRole("button", { name: SYNC_SLACK_BUTTON_NAME });
    expect(recovered).not.toHaveAttribute("aria-busy", "true");
    expect(recovered).not.toBeDisabled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
