/**
 * Canonical JSON (CLAUDE.md §7): keys sorted recursively, no whitespace,
 * strings NFC-normalised, integers only. Used for every hash over JSON.
 * Object fields whose value is undefined are omitted, like JSON.stringify.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

function encode(v: unknown, path: string): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "string":
      return JSON.stringify(v.normalize("NFC"));
    case "number":
      if (!Number.isSafeInteger(v)) throw new Error(`canonicalJson: ${path} is not a safe integer (${v})`);
      return Object.is(v, -0) ? "0" : String(v);
    case "object": {
      if (Array.isArray(v)) {
        return `[${v
          .map((item, i) => {
            if (item === undefined) throw new Error(`canonicalJson: ${path}[${i}] is undefined`);
            return encode(item, `${path}[${i}]`);
          })
          .join(",")}]`;
      }
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error(`canonicalJson: ${path} is not a plain object`);
      }
      const entries: [string, unknown][] = [];
      const seen = new Set<string>();
      for (const [k, val] of Object.entries(v)) {
        if (val === undefined) continue;
        const nk = k.normalize("NFC");
        if (seen.has(nk)) throw new Error(`canonicalJson: duplicate key after NFC at ${path}.${nk}`);
        seen.add(nk);
        entries.push([nk, val]);
      }
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${encode(val, `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof v} at ${path}`);
  }
}
