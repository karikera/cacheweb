import * as fs from "fs";
import * as path from "path";
import { extensionToMime } from "./mime";

const CACHE_MAX = 10 * 1024 * 1024;
const BASIC_SIZE = 256;
const UPDATE_DURATION = 10000;
const UPDATE_MAX_HIT = 10000;

class CacheList {
  private readonly map = new Map<string, FileCache>();
  private totalCacheSize = 0;
  private totalHit = 0;
  private updateInterval: NodeJS.Timeout | null = null;
  private cachedFirst: FileCache | null = null;

  constructor() {}

  private _updateState() {
    this.totalHit *= 0.5;
    for (const file of this.map.values()) {
      file.hitCount *= 0.5;
    }
    let node = this.cachedFirst;
    while (node !== null && node.hitCount < 0.2) {
      const next: FileCache | null = node.next;
      node.next = null;
      node.prev = null;
      this.totalCacheSize -= node.cacheSize;
      this.totalHit -= node.hitCount;
      this.map.delete(node.filepath);
      node = next;
    }
    if (node !== this.cachedFirst) {
      this.cachedFirst = node;
      if (node !== null) node.prev = null;
    }
    console.log(`reducing...`);
    console.log(`total hit: ${this.totalHit.toFixed(1)}`);
    console.log(`total cache: ${this.totalCacheSize}Bytes`);
    console.log(`total files: ${this.map.size}`);
  }

  private _deleteTo(target: FileCache, to: FileCache | null) {
    let file = this.cachedFirst;
    let targetFound = false;
    while (file !== null && file !== to) {
      const next = file.next;
      if (file !== target) {
        this.totalCacheSize -= file.cacheSize;
        this.totalHit -= file.hitCount;
        file.next = null;
        file.prev = null;
        this.map.delete(file.filepath);
      } else {
        targetFound = true;
      }
      file = next;
    }
    if (targetFound) {
      if (file !== null) file.prev = target;
      this.cachedFirst = target;
      target.next = file;
      target.prev = null;
    } else {
      if (file !== null) file.prev = null;
      this.cachedFirst = file;
    }
  }

  private _deleteCount(num: number): void {
    let file = this.cachedFirst;
    while (file !== null && num !== 0) {
      num--;
      const next = file.next;
      this.totalCacheSize -= file.cacheSize;
      this.totalHit -= file.hitCount;
      file.next = null;
      file.prev = null;
      this.map.delete(file.filepath);
      file = next;
    }
    if (file !== null) file.prev = null;
    this.cachedFirst = file;
  }

  private _sortNode(file: FileCache): void {
    const hitCount = file.hitCount;
    let axis = file;
    for (;;) {
      const next = axis.next;
      if (next !== null && hitCount > next.hitCount) {
        axis = next;
      } else {
        if (axis === file) break;
        const filePrev = file.prev;
        const fileNext = file.next;

        if (filePrev === null) this.cachedFirst = fileNext;
        else filePrev.next = fileNext;
        fileNext!.prev = filePrev;

        if (next !== null) next.prev = file;
        file.next = next;
        file.prev = axis;
        axis.next = file;
        return;
      }
    }
    axis = file;
    for (;;) {
      const prev = axis.prev;
      if (prev !== null && hitCount < prev.hitCount) {
        axis = prev;
      } else {
        if (axis === file) break;
        const filePrev = file.prev;
        const fileNext = file.next;

        filePrev!.next = fileNext;
        if (fileNext !== null) fileNext.prev = filePrev;

        if (prev !== null) prev.prev = file;
        else this.cachedFirst = file;
        file.next = axis;
        file.prev = prev;
        axis.prev = file;
        return;
      }
    }
  }

  makeNewSpace(target: FileCache, newCacheSize: number): boolean {
    const available = CACHE_MAX - this.totalCacheSize;
    let need = newCacheSize - target.cacheSize - available;
    let cached = true;
    _return: if (need > 0) {
      let file: FileCache | null = this.cachedFirst;
      let hitCount = target.hitCount;
      while (file !== null) {
        if (file !== target) {
          need -= file.cacheSize;
          hitCount -= file.hitCount;
          if (hitCount <= 0) {
            newCacheSize = BASIC_SIZE;
            target.content = null;
            cached = false;
            break _return;
          }
        }
        file = file.next;
        if (need <= 0) break;
      }
      this._deleteTo(target, file);
    }
    this.totalCacheSize += newCacheSize - target.cacheSize;
    target.cacheSize = newCacheSize;
    console.log(`total cache: ${this.totalCacheSize}Bytes`);
    return cached;
  }

  hit(file: FileCache, size: number): boolean {
    file.hitCount++;
    this.totalHit++;

    if (file.cacheSize === -1) {
      file.cacheSize = BASIC_SIZE;
      this.totalCacheSize += file.cacheSize;
      if (this.totalCacheSize > CACHE_MAX) {
        this._deleteCount(5);
      }
      // insert
      console.log(`cache inserted: ${file.filepath}`);
      const hitCount = file.hitCount;
      let axis = this.cachedFirst;
      if (axis === null) {
        this.cachedFirst = file;
      } else {
        for (;;) {
          const next: FileCache | null = axis.next;
          if (next !== null && hitCount > next.hitCount) {
            axis = next;
          } else {
            if (next !== null) next.prev = file;
            file.next = next;
            file.prev = axis;
            axis.next = file;
            break;
          }
        }
      }
    } else {
      this._sortNode(file);
    }

    let newCacheSize = size + BASIC_SIZE;
    if (newCacheSize > CACHE_MAX) return false;
    if (file.cacheSize === newCacheSize) return true;

    if (this.updateInterval !== null) clearInterval(this.updateInterval);
    if (this.totalHit >= UPDATE_MAX_HIT) {
      this._updateState();
    }
    this.updateInterval = setInterval(() => {
      this._updateState();
    }, UPDATE_DURATION);

    return this.makeNewSpace(file, newCacheSize);
  }

  get(filepath: string): FileCache {
    filepath = path.join(dirroot, filepath);
    let file = this.map.get(filepath);
    if (file === undefined) {
      file = new FileCache(filepath);
      this.map.set(filepath, file);
    }
    return file;
  }
}

const cacheList = new CacheList();

const dirroot = process.cwd();

export class FileCache {
  mtime = 0;
  keepTo = 0;
  statResult: Promise<fs.Stats> | null = null;
  content: Buffer | null = null;
  ext: string;
  mime: string;

  hitCount = 0;
  cacheSize = -1;
  contentCachable = false;
  next: FileCache | null = null;
  prev: FileCache | null = null;

  constructor(public filepath: string) {
    this.ext = path.extname(filepath).substr(1);
    let mime = extensionToMime.get(this.ext || "/" + path.basename(filepath));
    if (mime === undefined) {
      mime = "application/octet-stream";
      if (this.ext !== "")
        console.error(`unknown extension: ${path.basename(filepath)}`);
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
    if (this.content !== null) {
      const stat = await this.stat();
      const mtime = stat.mtimeMs;
      if (mtime === this.mtime) {
        return this.content;
      }
      this.mtime = mtime;
    }
    const content = await fs.promises.readFile(this.filepath);
    if (this.contentCachable) {
      this.content = content;
    }
    return content;
  }

  async readdir(): Promise<Buffer> {
    if (this.content !== null) {
      const stat = await this.stat();
      const mtime = stat.mtimeMs;
      if (mtime === this.mtime) {
        return this.content;
      }
      this.mtime = mtime;
    }
    const diruri = path.relative(dirroot, this.filepath).replace(/\\/g, "/");
    let content = "<body>";
    for (const name of await fs.promises.readdir(this.filepath)) {
      content += `<a href="${diruri}/${name}">${name}</a><br>`;
    }
    content += "</body>";
    const contentBuffer = Buffer.from(content);
    if (this.contentCachable) {
      this.content = contentBuffer;
    }
    return contentBuffer;
  }
}

export const fileCache = {
  async get(filepath: string): Promise<FileCache> {
    const file = cacheList.get(filepath);
    const stat = await file.stat().catch(() => null);
    file.contentCachable = cacheList.hit(file, stat !== null ? stat.size : 0);
    return file;
  },
  stat(filepath: string): Promise<fs.Stats> {
    return cacheList.get(filepath).stat();
  },
  read(filepath: string): Promise<Buffer> {
    return cacheList.get(filepath).read();
  },
};
