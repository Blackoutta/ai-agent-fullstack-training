export type Args = Record<string, unknown>;

export function text(args: Args, key: string): string {
  return String(args[key]);
}

export function optionalText(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function integer(args: Args, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === "number" ? Math.trunc(value) : fallback;
}

export function flag(args: Args, key: string): boolean {
  return args[key] === true;
}

export function edits(args: Args, key: string): Array<{ oldText: string; newText: string }> {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value as Array<{ oldText: string; newText: string }>;
}
