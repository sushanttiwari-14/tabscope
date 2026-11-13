export function editDistance(a: string, b: string, limit: number): boolean {
  const x = [...a],
    y = [...b];
  if (Math.abs(x.length - y.length) > limit) return false;
  let previous: number[] = [];
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const next = Array<number>(y.length + 1).fill(limit + 1);
    next[0] = i;
    for (
      let j = Math.max(1, i - limit);
      j <= Math.min(y.length, i + limit);
      j++
    ) {
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + Number(x[i - 1] !== y[j - 1]),
      );
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1])
        next[j] = Math.min(next[j], previous[j - 2] + 1);
    }
    if (Math.min(...next) > limit) return false;
    previous = row;
    row = next;
  }
  return row[y.length] <= limit;
}
