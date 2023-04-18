#!/usr/bin/env node

import * as fs from "fs";
import * as http from "http";
import * as stream from "stream";
import * as path from "path";
import * as net from "net";
import { FileCache } from "./filecache";
import { onOptionLoaded, options } from "./options";

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

async function processHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  function sendHtml(status: number, text: string) {
    const content = Buffer.from(text, "utf8");
    res.writeHead(status, {
      "Content-Type": "text/html",
      "Cache-Control": "no-cache",
      "Content-Length": content.length,
    });
    res.end(content);
  }

  function sendErrorPage(err: Error) {
    sendHtml(
      500,
      "<body>Internal Server Error<br>" + err.stack!.replace(/\n/g, "<br>")
    );
    console.error(err);
  }

  async function sendFile(statusCode: number, file: FileCache) {
    try {
      const lastModified = file.mtime.toUTCString();
      if (req.headers["if-modified-since"] === lastModified) {
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
            "Content-Length": content.length,
          });
          res.end(content);
        } else {
          const header: http.OutgoingHttpHeaders = {
            "Last-Modified": lastModified,
            "Cache-Control": "must-revalidate",
            "Content-Length": file.size,
          };
          if (file.mime === null) {
            header["Content-Type"] = "application/octet-stream";
            header["Content-Disposition"] =
              "attachment; filename=" +
              path
                .basename(file.filepath)
                .replace(/ /g, "_")
                .replace(/[^a-zA-Z0-9_.]/g, "");
          } else {
            header["Content-Type"] = file.mime;
          }
          res.writeHead(statusCode, header);
          if (file.contentCachable) {
            const content = await file.read();
            res.end(content);
          } else {
            await pipeStream(
              res,
              fs.createReadStream(options.root + path.sep + file.filepath)
            );
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
    sendHtml(404, "<body>File not found: " + pathname);
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
      if (options.index !== null) {
        pathname += "/" + options.index;
        try {
          const indexFile = await FileCache.get(pathname, false);
          if (indexFile.isDirectory) return send404();
          return sendFile(200, indexFile);
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
      }
      if (!options.showDirectory) {
        return send404();
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
}

let server: http.Server | null = null;
let openedPort = -1;
const sockets = new Set<net.Socket>();

onOptionLoaded.push(() => {
  const port = options.port;
  if (openedPort === port) return;
  openedPort = port;
  if (server !== null) {
    server.close();
    server = null;
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();
  }
  if (port < 0) return;
  server = http.createServer(processHttp);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
  });
  server.listen(port, () => {
    console.log(`listening ${port} port`);
  });
});
