import * as fs from "fs";
import * as path from "path";

export interface CacheWebOptions {
  port: number;
  root: string;
  mime: Record<string, string>;
  [404]: string | null;
}

// read options

let opts: CacheWebOptions;
try {
  opts = JSON.parse(fs.readFileSync(".webmerc.json", "utf8"));
} catch (err) {
  if (err.code !== "ENOENT") {
    console.error(".webmerc.json is invalid");
    console.error(err.message);
    process.exit(-1);
  }
  opts = {} as any;
}

if (typeof opts !== "object") {
  console.error(".webmerc.json is not object");
  process.exit(-1);
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

const mime = opts.mime;
if (mime instanceof Array || typeof mime !== "object") {
  opts.mime = {};
} else {
  for (const [key, value] of Object.entries(mime)) {
    if (typeof value !== "string") delete mime[key];
  }
}

export const options = opts;
