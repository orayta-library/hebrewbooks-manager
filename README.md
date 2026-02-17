# hebrewbooks-manager

## Run (Development)

1. Open a terminal in this folder.
2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

Then open:

- http://localhost:5177

## Build (Static)

To create a static build for deployment on any web server:

```bash
npm run build
```

The built files will be in the `dist/` folder. Upload the entire `dist/` folder to your web server.

To preview the static build locally:

```bash
npm run preview
```

## Notes

- The app reads the CSV from `hebrew_books.csv` in the same folder.
- To use a different CSV path:

```bash
set CSV_PATH=C:\\path\\to\\hebrew_books.csv && npm start
```

## Files

- `hebrew_books.csv` – the books database (copied from the parent folder)
- `public/favicon.png` – the favicon (copied from the parent folder)
- `public/manifest.json` – PWA manifest for installability
