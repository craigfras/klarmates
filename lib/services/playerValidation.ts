/**
 * playerValidation — pure Player input validation.
 *
 * Validates that a Player object has all required fields populated with
 * meaningful, non-whitespace values and that the email passes a basic
 * `local@domain` shape check.
 *
 * Design choices:
 *   - Each field is validated independently and throws its own descriptive
 *     Error, so callers always know which field failed.
 *   - Email validation uses a simple split-on-"@" approach: exactly two
 *     non-empty parts, no embedded spaces. No regex library, no RFC compliance.
 *   - No I/O, no side effects — pure functions only.
 */

import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The delimiter that separates the local and domain parts of an email. */
const EMAIL_SEPARATOR = "@";

/** The expected number of parts after splitting an email on EMAIL_SEPARATOR. */
const EMAIL_PART_COUNT = 2;

// ---------------------------------------------------------------------------
// Internal field validators
// ---------------------------------------------------------------------------

/** Returns true when the value is non-null and contains at least one non-whitespace character. */
const isNonBlank = (value: string): boolean => value.trim().length > 0;

/**
 * Returns true when the email has the minimal `local@domain` shape:
 *   - Splits on EMAIL_SEPARATOR into exactly EMAIL_PART_COUNT parts.
 *   - Both the local and domain parts must be non-empty and free of spaces.
 */
const isValidEmailShape = (email: string): boolean => {
  const parts = email.split(EMAIL_SEPARATOR);
  if (parts.length !== EMAIL_PART_COUNT) return false;
  const [local, domain] = parts;
  return (
    local.length > 0 &&
    domain.length > 0 &&
    !local.includes(" ") &&
    !domain.includes(" ")
  );
};

// ---------------------------------------------------------------------------
// validatePlayerInput
// ---------------------------------------------------------------------------

/**
 * Validates all required fields on a Player input object.
 *
 * Throws an `Error` with a descriptive message for the first field that fails
 * validation. Each field is checked independently so the error always
 * identifies the offending field.
 *
 * Returns `void` when the player is valid.
 */
export const validatePlayerInput = (input: Player): void => {
  if (!isNonBlank(input.id)) {
    throw new Error(`Player id must be a non-empty, non-whitespace string.`);
  }

  if (!isNonBlank(input.name)) {
    throw new Error(`Player name must be a non-empty, non-whitespace string.`);
  }

  if (!isNonBlank(input.email)) {
    throw new Error(`Player email must be a non-empty, non-whitespace string.`);
  }

  if (!isValidEmailShape(input.email)) {
    throw new Error(
      `Player email "${input.email}" is invalid: must have the form local${EMAIL_SEPARATOR}domain with non-empty local and domain parts and no spaces.`,
    );
  }
};
