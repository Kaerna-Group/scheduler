export function weeks(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

export function formatWeeks(weeks: number[]) {
  const values = [...new Set(weeks)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < values.length; index++) {
    const start = values[index];
    while (values[index + 1] === values[index] + 1) index++;
    const end = values[index];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return ranges.join(', ');
}
