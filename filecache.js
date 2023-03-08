"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileCache = exports.FileCache = void 0;
const fs = require("fs");
const path = require("path");
const extensionToMime = new Map();
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
class FileCache {
    constructor(filepath) {
        this.filepath = filepath;
        this.mtime = 0;
        this.keepTo = 0;
        this.statResult = null;
        this.content = null;
        this.ext = path.extname(filepath).substr(1);
        let mime = extensionToMime.get(this.ext);
        if (mime === undefined) {
            mime = "application/octet-stream";
            console.error(`unknown extension: ${this.ext}`);
        }
        this.mime = mime;
    }
    stat() {
        if (this.statResult !== null) {
            const now = Date.now();
            if (now < this.keepTo)
                return this.statResult;
            this.keepTo = now + 100;
        }
        const statResult = fs.promises.stat(this.filepath);
        return (this.statResult = statResult);
    }
    async read() {
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
exports.FileCache = FileCache;
const cachemap = new Map();
exports.fileCache = {
    get(filepath) {
        filepath = path.resolve(filepath);
        let cache = cachemap.get(filepath);
        if (cache === undefined)
            cachemap.set(filepath, (cache = new FileCache(filepath)));
        return cache;
    },
    stat(filepath) {
        return exports.fileCache.get(filepath).stat();
    },
    read(filepath) {
        return exports.fileCache.get(filepath).read();
    },
};
