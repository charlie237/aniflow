type MessageTree = {
  [key: string]: string | MessageTree;
};

export type TranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

export function createT(messages: MessageTree): TranslateFn {
  return function t(key, params) {
    const raw = lookup(messages, key);
    if (raw == null) return key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = params[name];
      return value == null ? `{${name}}` : String(value);
    });
  };
}

function lookup(messages: MessageTree, key: string): string | null {
  const parts = key.split(".");
  let current: string | MessageTree | undefined = messages;
  for (const part of parts) {
    if (current == null || typeof current === "string") return null;
    current = current[part];
  }
  return typeof current === "string" ? current : null;
}
