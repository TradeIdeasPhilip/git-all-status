import { styleText } from 'node:util';

/**
 * Formats a number using digit grouping, but instead of printing commas,
 * alternates bolding every other group of 3 digits (starting un-bolded).
 * This makes the output paste-able directly into code or a calculator while
 * still being easy to read at a glance. Bolding is always off across the
 * decimal point.
 *
 * Bold is only emitted when `stream` is a terminal.
 */
export function formatGrouped(
  value: number,
  decimals = 0,
  stream: NodeJS.WriteStream = process.stdout,
): string {
  const [intPart, fracPart] = value.toFixed(decimals).split('.');
  const groups: string[] = [];
  let remaining = intPart!;
  while (remaining.length > 3) {
    groups.unshift(remaining.slice(-3));
    remaining = remaining.slice(0, -3);
  }
  groups.unshift(remaining);

  let bold = false;
  let out = '';
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    out += bold ? styleText('bold', group, { stream }) : group;
    if (i < groups.length - 1) {
      bold = !bold;
    }
  }

  return fracPart !== undefined ? `${out}.${fracPart}` : out;
}
