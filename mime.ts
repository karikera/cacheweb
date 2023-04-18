import { onOptionLoaded, options } from "./options";
import globToRegExp = require("glob-to-regexp");
import * as path from "path";
import * as mime from "mime-types";

const nameMatch: [RegExp, string][] = [];

onOptionLoaded.push(() => {
  nameMatch.length = 0;
  for (const [key, value] of Object.entries(options.mime)) {
    nameMatch.push([globToRegExp(key), value]);
  }
});

export function getMimeType(filepath: string): string | null {
  const rpath = path.relative(options.root, filepath);
  const mimeType = mime.lookup(rpath);
  if (mimeType !== false) return mimeType;

  for (const [regexp, type] of nameMatch) {
    if (regexp.test(rpath)) return type;
  }
  return null;
}
