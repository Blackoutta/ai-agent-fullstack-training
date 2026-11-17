const MODEL_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function toModelToolName(internalName: string): string {
  const mapped = internalName.replaceAll(".", "__").replace(/[^A-Za-z0-9_-]/g, "_");
  if (!MODEL_TOOL_NAME.test(mapped)) {
    throw new Error(`Tool name cannot be projected safely: ${internalName}`);
  }
  return mapped;
}
