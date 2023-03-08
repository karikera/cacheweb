import * as fs from "fs";
import * as path from "path";

const extensionToMime = new Map<string, string>();
extensionToMime.set("js", "text/javascript");
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

export class FileCache {
  mtime = 0;
  keepTo = 0;
  statResult: Promise<fs.Stats> | null = null;
  content: Buffer | null = null;
  ext: string;
  mime: string;

  constructor(public filepath: string) {
    this.ext = path.extname(filepath).substr(1);
    let mime = extensionToMime.get(this.ext);
    if (mime === undefined) {
      mime = "application/octet-stream";
      console.error(`unknown extension: ${this.ext}`);
    }
    this.mime = mime;
  }

  stat(): Promise<fs.Stats> {
    if (this.statResult !== null) {
      const now = Date.now();
      if (now < this.keepTo) return this.statResult;
      this.keepTo = now + 100;
    }
    const statResult = fs.promises.stat(this.filepath);
    return (this.statResult = statResult);
  }

  async read(): Promise<Buffer> {
    const statProm = this.stat();
    if (this.content !== null) {
      const stat = await statProm;
      const mtime = stat.mtimeMs;
      if (mtime === this.mtime) {
        this.mtime = mtime;
        return this.content;
      }
    }
    return (this.content = await fs.promises.readFile(this.filepath));
  }
}

const cachemap = new Map<string, FileCache>();

export const fileCache = {
  get(filepath: string): FileCache {
    filepath = path.resolve(filepath);
    let cache = cachemap.get(filepath);
    if (cache === undefined)
      cachemap.set(filepath, (cache = new FileCache(filepath)));
    return cache;
  },
  stat(filepath: string): Promise<fs.Stats> {
    return fileCache.get(filepath).stat();
  },
  read(filepath: string): Promise<Buffer> {
    return fileCache.get(filepath).read();
  },
};
