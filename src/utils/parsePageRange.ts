/**
 * Parse a user-typed page range expression like "1-5, 8, 10-12" into a sorted,
 * deduplicated list of page numbers clamped to [1, totalPages].
 *
 * Lenient by design: Chinese/Western separators both work, reversed ranges are
 * swapped, out-of-range parts are clamped, and unparseable tokens are skipped.
 */
export function parsePageRange(input: string, totalPages: number): number[] {
  const result = new Set<number>();

  for (const token of input.split(/[,，;；\s]+/)) {
    if (!token) continue;

    const match = token.match(/^(\d+)(?:\s*[-–~至]\s*(\d+))?$/);
    if (!match) continue;

    let start = Number(match[1]);
    let end = match[2] !== undefined ? Number(match[2]) : start;
    if (start > end) [start, end] = [end, start];

    start = Math.max(1, start);
    end = Math.min(totalPages, end);

    for (let pageNumber = start; pageNumber <= end; pageNumber++) {
      result.add(pageNumber);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
