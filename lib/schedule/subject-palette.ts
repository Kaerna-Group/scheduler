export const subjectPalette = [
  '#f59f65',
  '#7b86c6',
  '#5f8fdb',
  '#4c9d8b',
  '#d87575',
  '#a276c7',
  '#9b8c51',
  '#5c7e83',
] as const;

const subjectColorPattern = /^#[0-9a-f]{6}$/i;

export function isSubjectColor(value: unknown): value is string {
  return typeof value === 'string' && subjectColorPattern.test(value.trim());
}

export function subjectColorAt(index: number) {
  return subjectPalette[index % subjectPalette.length];
}
