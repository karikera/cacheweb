# webme

Http server for debuging web pages.

- `webme` always re-send the page if the page is modified.

## Usage

- local install

```sh
npm i webme
npx webme # default port = 8080, default path = .
npx webme .
npx webme path/to/webroot
npx webme --port 8080
```

- global install

```sh
npm i -g webme
webme
```

## .webme.json

```json
{
  "port": 8080, // default
  "root": ".", // default, current working directory
  "mime": {
    "**/*.js": "text/javascript" // default
  },
  "404": "404.html" // default, root relative path, nullable
}
```
