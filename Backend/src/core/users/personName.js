/** A person's name: letters (any script), spaces and . ' - only, 2-50 characters - never digits. */
const NAME = /^[\p{L}\p{M} .'-]{2,50}$/u;
const A_LETTER = /\p{L}/u;

export const isPersonName = (value) => {
  const v = String(value ?? '').trim();
  return NAME.test(v) && A_LETTER.test(v);
};
