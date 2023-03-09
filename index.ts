#!/usr/bin/env node

import * as http from "http";
import * as stream from "stream";
import * as fs from "fs";
import { FileCache, fileCache } from "./filecache";

function pipeStream(
  write: stream.Writable,
  read: stream.Readable
): Promise<void> {
  read.pipe(write);
  return new Promise((resolve, reject) => {
    write.once("end", resolve);
    read.once("error", reject);
    write.once("error", reject);
  });
}

class ArgReader {
  private i = 1;
  private readonly n = process.argv.length;

  next(): string | null {
    if (this.i >= this.n) return null;
    return process.argv[this.i++];
  }
}
const args = new ArgReader();

let port = 8080;
_done: for (;;) {
  switch (args.next()) {
    case "--port":
      port = +args.next()!;
      break;
    case null:
      break _done;
  }
}

const server = http.createServer(async (req, res) => {
  function emitErrorPage(err: Error) {
    res.writeHead(500, {
      "Content-Type": "text/html",
      "Cache-Control": "no-cache",
    });
    res.end(
      "<body>Internal Server Error<br>" + err.stack!.replace(/\n/g, "<br>")
    );
    console.error(err);
  }

  let pathname = req.url;
  if (pathname === undefined) return;
  if (pathname === "/") {
    pathname = ".";
  } else if (pathname.startsWith("/")) {
    pathname = pathname.substr(1);
  }

  let dirFile: FileCache | null = null;
  const ifModifiedSince = req.headers["if-modified-since"];

  try {
    for (;;) {
      const file = await fileCache.get(pathname);
      const stat = await file.stat();
      if (stat.isDirectory()) {
        dirFile = file;
        pathname += "/index.html";
        continue;
      }
      const lastModified = stat.mtime.toUTCString();
      if (ifModifiedSince === lastModified) {
        res.writeHead(304, {
          "Cache-Control": "must-revalidate",
        });
        res.end();
      } else {
        if (file.contentCachable) {
          const content = await file.read();
          res.writeHead(200, {
            "Content-Type": file.mime,
            "Last-Modified": lastModified,
            "Cache-Control": "must-revalidate",
          });
          res.end(content);
        } else {
          res.writeHead(200, {
            "Content-Type": file.mime,
            "Last-Modified": lastModified,
            "Cache-Control": "must-revalidate",
          });
          pipeStream(res, fs.createReadStream(file.filepath));
        }
      }
      return;
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      if (dirFile !== null) {
        try {
          const stat = await dirFile.stat();
          const lastModified = stat.mtime.toUTCString();
          if (ifModifiedSince === lastModified) {
            res.writeHead(304, {
              "Cache-Control": "must-revalidate",
            });
            res.end();
          } else {
            const content = await dirFile.readdir();
            res.writeHead(200, {
              "Content-Type": "text/html",
              "Last-Modified": lastModified,
              "Cache-Control": "must-revalidate",
            });
            res.end(content);
          }
        } catch (err) {
          emitErrorPage(err);
        }
      } else {
        res.writeHead(404, {
          "Content-Type": "text/html",
          "Cache-Control": "no-cache",
        });
        res.end("<body>File not found: " + pathname);
      }
    } else {
      emitErrorPage(err);
    }
  }
  res.end();
});
server.listen(port, () => {
  console.log(`listening ${port} port`);
});
