import * as fs from "fs";
import * as path from "path";
import { getMimeType } from "./mime";
import { options } from "./options";

const CACHE_MAX = 10 * 1024 * 1024;
const BASIC_SIZE = 256;
const UPDATE_DURATION = 10000;
const UPDATE_MAX_HIT = 10000;
const HIT_REMOVING_THRESHOLD = 0.4;

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
    while (node !== null && node.hitCount < HIT_REMOVING_THRESHOLD) {
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
    const zeroReported =
      this.totalHit === 0 && this.totalCacheSize === 0 && this.map.size === 0;
    if (zeroReported && this.updateInterval !== null) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
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
            target.contentMtime = 0;
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

  hit(file: FileCache): boolean {
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

    let newCacheSize = file.size + BASIC_SIZE;
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

  get(filepath: string, allowAbsolute: boolean): FileCache {
    filepath = path.normalize(filepath);
    if (!allowAbsolute) {
      if (
        path.isAbsolute(filepath) ||
        filepath.split(path.sep, 1)[0] === ".."
      ) {
        const err: NodeJS.ErrnoException = Error("access denided");
        err.code = "ENOENT";
        throw err;
      }
    }

    let file = this.map.get(filepath);
    if (file === undefined) {
      file = new FileCache(filepath);
      this.map.set(filepath, file);
    }
    return file;
  }
}

const cacheList = new CacheList();

export class FileCache {
  keepTo = 0;
  mime: string | null;

  hitCount = 0;
  cacheSize = -1;
  contentCachable = false;
  next: FileCache | null = null;
  prev: FileCache | null = null;

  size: number;
  mtime: Date = null as any;
  isDirectory = false;
  mtimeMs = 0;

  content: Buffer | null = null;
  contentMtime = 0;

  private updateProm: Promise<void> | null = null;

  constructor(public filepath: string) {
    this.mime = getMimeType(filepath);
  }

  private _updateStat(): Promise<void> {
    if (this.updateProm !== null) {
      const now = Date.now();
      if (now < this.keepTo) return this.updateProm;
      this.keepTo = now + 100;
    }
    const statResult = fs.promises.stat(
      options.root + path.sep + this.filepath
    );
    return (this.updateProm = statResult.then(
      (stat) => {
        this.size = stat.size;
        this.mtime = stat.mtime;
        this.mtimeMs = stat.mtimeMs;
        this.isDirectory = stat.isDirectory();
        this.contentCachable = cacheList.hit(this);
      },
      (err) => {
        this.size = 0;
        this.mtime = null as any;
        this.mtimeMs = 0;
        this.isDirectory = false;
        this.contentCachable = cacheList.hit(this);
        throw err;
      }
    ));
  }

  async read(): Promise<Buffer> {
    if (this.content !== null) {
      if (this.mtimeMs === this.contentMtime) {
        return this.content;
      }
    }
    const content = await fs.promises.readFile(
      options.root + path.sep + this.filepath
    );
    if (this.contentCachable) {
      this.content = content;
      this.contentMtime = this.mtimeMs;
    } else {
      this.content = content;
      this.contentMtime = 0;
    }
    return content;
  }

  async readdir(): Promise<Buffer> {
    if (this.content !== null) {
      if (this.mtimeMs === this.contentMtime) {
        return this.content;
      }
      this.contentMtime = this.mtimeMs;
    }
    const diruri = path
      .relative(options.root, this.filepath)
      .replace(/\\/g, "/");
    let content = "<body>";
    for (const name of await fs.promises.readdir(
      options.root + path.sep + this.filepath
    )) {
      content += `<a href="${diruri}/${name}">${name}</a><br>`;
    }
    content += "</body>";
    const contentBuffer = Buffer.from(content);
    if (contentBuffer.length < CACHE_MAX) {
      this.content = contentBuffer;
      this.contentMtime = this.contentMtime;
    } else {
      this.content = null;
      this.contentMtime = 0;
    }
    return contentBuffer;
  }
  static async get(
    filepath: string,
    allowAbsolute: boolean
  ): Promise<FileCache> {
    const file = cacheList.get(filepath, allowAbsolute);
    await file._updateStat();
    return file;
  }
}
