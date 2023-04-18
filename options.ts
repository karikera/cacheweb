import * as fs from "fs";
import * as path from "path";

export interface CacheWebOptions {
  port: number;
  root: string;
  mime: Record<string, string>;
  [404]: string | null;
  index: string | null;
  showDirectory: boolean;
}

// read options

export function loadOptionsSync(): void {
  let opts: CacheWebOptions;
  try {
    opts = JSON.parse(fs.readFileSync(".webmerc.json", "utf8"));
    console.log(".webmerc.json loaded");
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(".webmerc.json is invalid");
      console.error(err.message);
    }
    opts = {} as any;
  }

  if (typeof opts !== "object") {
    console.error(".webmerc.json is not object");
    opts = {} as any;
  }

  // read args

  let argi = 2;
  const argn = process.argv.length;

  function nextArg(): string | null {
    if (argi >= argn) return null;
    return process.argv[argi++];
  }

  _done: for (;;) {
    const value = nextArg();
    switch (value) {
      case "--port":
        opts.port = +nextArg()!;
        break;
      case null:
        break _done;
      default:
        opts.root = value;
        break;
    }
  }

  // normalize options

  if (typeof opts.port !== "number") opts.port = 8080;
  else opts.port |= 0;
  if (typeof opts.root !== "string") {
    opts.root = process.cwd();
  } else {
    opts.root = path.resolve(opts.root);
  }
  if (typeof opts[404] !== "string") {
    if (opts[404] !== null) {
      opts[404] = "404.html";
    }
  } else {
    opts[404] = path.normalize(opts[404]);
  }
  if (typeof opts.index !== "string") {
    if (opts.index !== null) {
      opts.index = "index.html";
    }
  }
  opts.showDirectory = opts.showDirectory !== false;

  const mime = opts.mime;
  if (mime instanceof Array || typeof mime !== "object") {
    opts.mime = {};
  } else {
    for (const [key, value] of Object.entries(mime)) {
      if (typeof value !== "string") delete mime[key];
    }
  }
  options = opts;
  for (const onload of onOptionLoaded) onload();
}

export let options: CacheWebOptions;
export const onOptionLoaded: (() => void)[] = [];

const WATCH_THRESHOLD = 500;
let watchThreshold = Date.now() + WATCH_THRESHOLD;
fs.watch(process.cwd(), (type, filename) => {
  if (filename === ".webmerc.json") {
    const now = Date.now();
    if (watchThreshold > now) return;
    watchThreshold = now + WATCH_THRESHOLD;
    loadOptionsSync();
  }
});

setTimeout(loadOptionsSync);
