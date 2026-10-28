/** Generic, progressive slash-command argument completion. */
export interface SlashArgumentCompletionItem {
  value: string;
  label: string;
  description?: string;
}
export interface SlashArgumentContext {
  name: string;
  prefix: string;
  argumentStart: number;
  cursor: number;
}

/** Only identify /name and its full argument prefix; the plugin owns grammar. */
export function parseSlashArgumentContext(text: string, cursor: number): SlashArgumentContext | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) return null;
  const before = text.slice(0, cursor);
  if (!before.startsWith("/") || /[\r\n]/.test(before)) return null;
  const separator = before.search(/[ \t]/);
  if (separator <= 1) return null;
  const name = before.slice(1, separator);
  if (/\s/.test(name)) return null;
  return { name, prefix: before.slice(separator + 1), argumentStart: separator + 1, cursor };
}

/** value is the complete replacement argument prefix, not its final word. */
export function applySlashArgumentCompletion(
  text: string, context: SlashArgumentContext, value: string,
): { text: string; cursor: number } {
  return {
    text: text.slice(0, context.argumentStart) + value + text.slice(context.cursor),
    cursor: context.argumentStart + value.length,
  };
}

/** Invoke any Pi extension's optional callback, without special-casing commands. */
export async function querySlashArgumentCompletions(
  command: unknown, prefix: string,
): Promise<SlashArgumentCompletionItem[]> {
  if (typeof prefix !== "string" || prefix.length > 4096) return [];
  const callback = (command as { getArgumentCompletions?: unknown } | null)?.getArgumentCompletions;
  if (typeof callback !== "function") return [];
  const items: unknown = await callback.call(command, prefix);
  if (!Array.isArray(items)) return [];
  return items.slice(0, 50).filter((item): item is SlashArgumentCompletionItem => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return typeof value.value === "string" && typeof value.label === "string"
      && value.value.length <= 4096 && value.label.length <= 512
      && (value.description === undefined || typeof value.description === "string");
  });
}
