#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const http = require("http");
const fs = require("fs");
const filecache_1 = require("./filecache");
function pipeStream(write, read) {
    read.pipe(write);
    return new Promise((resolve, reject) => {
        write.once("end", resolve);
        read.once("error", reject);
        write.once("error", reject);
    });
}
class ArgReader {
    constructor() {
        this.i = 1;
        this.n = process.argv.length;
    }
    next() {
        if (this.i >= this.n)
            return null;
        return process.argv[this.i++];
    }
}
const args = new ArgReader();
let noCache = false;
let port = 8080;
_done: for (;;) {
    switch (args.next()) {
        case "--nocache":
            noCache = true;
            break;
        case "--port":
            port = +args.next();
            break;
        case null:
            break _done;
    }
}
const server = http.createServer(async (req, res) => {
    let pathname = req.url;
    try {
        if (pathname === undefined)
            return;
        if (pathname.endsWith("/")) {
            pathname += "index.html";
        }
        if (pathname.startsWith("/")) {
            pathname = pathname.substr(1);
        }
        const ifModifiedSince = req.headers["if-modified-since"];
        const file = filecache_1.fileCache.get(pathname);
        const stat = await file.stat();
        const lastModified = stat.mtime.toUTCString();
        if (ifModifiedSince === lastModified) {
            res.writeHead(304, {
                "Cache-Control": "must-revalidate",
            });
            res.end();
        }
        else {
            if (noCache) {
                res.writeHead(200, {
                    "Content-Type": file.mime,
                    "Last-Modified": lastModified,
                    "Cache-Control": "must-revalidate",
                });
                pipeStream(res, fs.createReadStream(file.filepath));
            }
            else {
                const content = await file.read();
                res.writeHead(200, {
                    "Content-Type": file.mime,
                    "Last-Modified": lastModified,
                    "Cache-Control": "must-revalidate",
                });
                res.end(content);
            }
        }
        return;
    }
    catch (err) {
        if (err.code === "ENOENT") {
            res.writeHead(404, {
                "Content-Type": "text/html",
                "Cache-Control": "no-cache",
            });
            res.end("<body>File not found: " + pathname);
        }
        else {
            res.writeHead(500, {
                "Content-Type": "text/html",
                "Cache-Control": "no-cache",
            });
            res.end("<body>Internal Server Error<br>" + err.stack.replace(/\n/g, "<br>"));
        }
    }
    res.end();
});
server.listen(port, () => {
    console.log(`listening ${port} port`);
});
