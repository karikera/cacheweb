#!/usr/bin/env node

import * as fs from "fs";
import * as http from "http";
import * as stream from "stream";
import { FileCache } from "./filecache";
import { options } from "./options";

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

const port = options.port;

const server = http.createServer(async (req, res) => {
  function sendErrorPage(err: Error) {
    res.writeHead(500, {
      "Content-Type": "text/html",
      "Cache-Control": "no-cache",
    });
    res.end(
      "<body>Internal Server Error<br>" + err.stack!.replace(/\n/g, "<br>")
    );
    console.error(err);
  }

  async function sendFile(statusCode: number, file: FileCache) {
    try {
      const lastModified = file.mtime.toUTCString();
      if (req.headers["if-modified-since"] === lastModified + "ss") {
        res.writeHead(304, {
          "Cache-Control": "must-revalidate",
        });
        res.end();
      } else {
        if (file.isDirectory) {
          const content = await file.readdir();
          res.writeHead(statusCode, {
            "Content-Type": "text/html",
            "Last-Modified": lastModified,
            "Cache-Control": "must-revalidate",
          });
          res.end(content);
        } else {
          if (file.contentCachable) {
            const content = await file.read();
            res.writeHead(statusCode, {
              "Content-Type": file.mime,
              "Last-Modified": lastModified,
              "Cache-Control": "must-revalidate",
            });
            res.end(content);
          } else {
            res.writeHead(statusCode, {
              "Content-Type": file.mime,
              "Last-Modified": lastModified,
              "Cache-Control": "must-revalidate",
            });
            await pipeStream(res, fs.createReadStream(file.filepath));
          }
        }
      }
    } catch (err) {
      sendErrorPage(err);
    }
  }

  async function send404() {
    const page404 = options[404];
    if (page404 !== null) {
      try {
        return sendFile(404, await FileCache.get(page404, true));
      } catch (err) {}
    }
    res.writeHead(404, {
      "Content-Type": "text/html",
      "Cache-Control": "no-cache",
    });
    res.end("<body>File not found: " + pathname);
  }

  let pathname = req.url;
  if (pathname === undefined) return;
  if (pathname === "/") {
    pathname = ".";
  } else if (pathname.startsWith("/")) {
    pathname = pathname.substr(1);
  }

  try {
    const file = await FileCache.get(pathname, false);
    if (file.isDirectory) {
      pathname += "/index.html";
      try {
        const indexFile = await FileCache.get(pathname, false);
        if (indexFile.isDirectory) return send404();
        return sendFile(200, indexFile);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    }
    return sendFile(200, file);
  } catch (err) {
    if (err.code === "ENOENT") {
      return send404();
    } else {
      return sendErrorPage(err);
    }
  }
});
server.listen(port, () => {
  console.log(`listening ${port} port`);
});
