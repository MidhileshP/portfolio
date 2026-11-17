# Midhilesh Polisetty — portfolio

A single-page portfolio in plain HTML, CSS and JavaScript. There is no build step and nothing to install.

## Preview

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Files

| Path | What it holds |
| --- | --- |
| `index.html` | All of the content. Edit text, links and skills here. |
| `css/styles.css` | Styles. Colours for both themes are the custom properties at the top. |
| `js/main.js` | Theme toggle, clock, scroll effects, the order pipeline and the stack filter. |
| `js/globe.js` | The hero globe: dotted Earth, satellites, drag to rotate, click to task a capture. |
| `js/demos.js` | The three project toys: the CRDT demo, the filter bench and the meme press. |
| `js/terminal.js` | The terminal overlay (`/` or Cmd/Ctrl+K). It reads its answers from the page. |
| `js/land.js` | Generated land mask for the globe (Natural Earth 110m, public domain). |
| `assets/` | Favicon and the résumé PDF linked from the page. |

## Editing content

- **Résumé**: replace `assets/Midhilesh-Polisetty-Resume.pdf` with the new file, keeping the name.
- **Work stages**: each stage is a `pipe-node` button plus a matching `pipe-panel` article in `index.html`.
- **Skills**: each skill is a button in the Stack section. `data-used="minfy docspace"` lists where it
  was used; the keys match the `data-filter` values on the filter buttons above the grid.
- **Projects**: each project is an `<article class="project">`. The terminal picks up changes on its own.

## Deploying

Any static host works. For GitHub Pages: push this folder to a repository, then choose
Settings → Pages → Deploy from a branch → `main` / root.
