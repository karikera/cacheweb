import { options } from "./options";
import globToRegExp = require("glob-to-regexp");
import * as path from "path";

const extensionToMime = new Map<string, string>();
extensionToMime.set("js", "text/javascript");
extensionToMime.set("ts", "text/typescript");
extensionToMime.set("htm", "text/html");
extensionToMime.set("html", "text/html");
extensionToMime.set("css", "text/css");
extensionToMime.set("wasm", "application/wasm");
extensionToMime.set("json", "application/json");
extensionToMime.set("map", "application/json");
extensionToMime.set("png", "image/png");
extensionToMime.set("gif", "image/gif");
extensionToMime.set("jpeg", "image/jpeg");
extensionToMime.set("jpg", "image/jpeg");
extensionToMime.set("ico", "image/vnd.microsoft.icon");
extensionToMime.set("md", "text/markdown");

const nameToMime = new Map<string, string>();
nameToMime.set(".prettierrc", "application/json");
nameToMime.set(".gitignore", "text/plain");
nameToMime.set(".prettierignore", "text/plain");
nameToMime.set(".npmignore", "text/plain");
nameToMime.set("COMMIT_EDITMSG", "text/plain");

const nameMatch: [RegExp, string][] = [];

for (const [key, value] of Object.entries(options.mime)) {
  nameMatch.push([globToRegExp(key), value]);
}

export function getMimeType(filepath: string): string | null {
  const rpath = path.relative(options.root, filepath);
  const parsed = path.parse(rpath);

  let mimeType: string | undefined;
  mimeType = extensionToMime.get(parsed.ext.substr(1));
  if (mimeType !== undefined) return mimeType;
  mimeType = nameToMime.get(parsed.base);
  if (mimeType !== undefined) return mimeType;

  for (const [regexp, type] of nameMatch) {
    if (regexp.test(rpath)) return type;
  }
  return null;
}
