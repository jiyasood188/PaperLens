# PaperLens

PaperLens is a local research-paper analysis prototype. Upload a scientific PDF to extract a concise summary, methodology, model names, recognized datasets, benchmark metric values, and verification notes.

## What it does

- Extracts text from PDFs in memory with `pypdf`; uploaded bytes and results are not saved by the backend.
- Uses local Python text-processing and regular expressions when no AI key is configured.
- Optionally sends extracted text to Google Gemini using a key held only by the backend.
- Keeps the current analysis in React application state and offers a JSON download.
- Lets you save an analysis to a local paper workspace with research notes, discussion, contributors, activity, and restorable notes versions. You can also start an analysis from Team workspace to create and open the project directly. Workspace data is stored in this browser's local storage; this prototype does not provide accounts, email invitations, or live multi-user sync.
- Accepts PDF files up to 25 MB and 500 pages. Scanned PDFs without an embedded text layer are not OCR-processed.

The local extractor is a best-effort prototype, not a substitute for reading and verifying the original paper. Text extraction can miss figures, equations, footnotes, and table structure. Uploaded PDFs and their full extracted text are not saved, but analyses you explicitly save to a workspace remain in browser local storage until cleared by the user or browser.

## Requirements

- Python 3.10+
- Node.js 18+

## Run on Windows

Open two terminals in the project folder.

### 1. Start the API

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

FastAPI docs: <http://127.0.0.1:8000/docs>

To enable Gemini, set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` in the same PowerShell terminal before starting the API:

```powershell
$env:GEMINI_API_KEY = "your-key"
$env:GEMINI_MODEL = "gemini-2.5-flash"
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

`backend/.env.example` documents the supported variable names; the prototype reads process environment variables directly and does not automatically load `.env` files. The key is never sent to or included in the frontend. With no key, PaperLens uses local rule-based extraction. If Gemini is configured but its request fails, the API reports the error rather than silently presenting a local result as AI analysis.

### 2. Start the frontend

```powershell
cd frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173>.

The frontend expects the API at `http://127.0.0.1:8000`. To use another backend URL, define `VITE_API_URL` in the frontend environment before starting Vite.

## API

- `GET /health` — service status and whether Gemini is configured (never returns the key).
- `POST /api/analyze` — multipart form upload with a `file` field containing a PDF.

Successful analysis JSON includes `paper_title`, `author`, `year`, `summary`, `methodology`, `datasets`, `metrics`, `verification_notes`, `page_count`, `word_count`, and `source`.

## Project layout

```text
backend/
  main.py
  requirements.txt
frontend/
  src/
    App.jsx
    main.jsx
    styles.css
  index.html
  package.json
  vite.config.js
```
