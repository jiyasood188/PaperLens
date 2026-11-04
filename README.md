# PaperLens

PaperLens is a local research-paper analysis prototype. Upload a scientific PDF to extract a concise summary, methodology, model names, recognized datasets, benchmark metric values, and verification notes.

## What it does

- Extracts text from PDFs in memory with `pypdf`; uploaded bytes and results are not saved by the backend.
- Uses local Python text-processing and regular expressions for analysis. No external AI service or API key is required.
- Keeps the current analysis in React application state and offers a JSON download.
- Lets you save an analysis to a local paper workspace with research notes, discussion, contributors, activity, and restorable notes versions. You can also start an analysis from Team workspace to create and open the project directly. Workspace data is stored in this browser's local storage; this prototype does not provide accounts, email invitations, or live multi-user sync.
- Accepts PDF files up to 25 MB and 500 pages. Scanned PDFs without an embedded text layer are not OCR-processed.

PaperLens runs locally: the browser UI talks to the included FastAPI server on your computer, and the ESP32 (if used) polls that same server on your local Wi-Fi. There are no third-party API calls or keys. The local extractor is a best-effort prototype, not a substitute for reading and verifying the original paper. Text extraction can miss figures, equations, footnotes, and table structure. Uploaded PDFs and their full extracted text are not saved, but analyses you explicitly save to a workspace remain in browser local storage until cleared by the user or browser.

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

### ESP32 + OLED display

The optional display unit uses an ESP32 DevKit and a 128×64 SSD1306 I²C OLED. It polls the backend over your local Wi-Fi network; paper extraction and AI processing still run on the computer. The device endpoint is read-only and requires a shared token.

#### Wiring

| OLED pin | ESP32 DevKit |
| --- | --- |
| VCC | 3V3 |
| GND | GND |
| SDA | GPIO 21 |
| SCL | GPIO 22 |

Use the OLED's 3.3 V-compatible supply. The example uses I²C address `0x3C`; change `OLED_ADDRESS` to `0x3D` in the device config if that is the address printed in the module documentation. The built-in BOOT button advances between status, title, datasets, metrics, models, and summary screens.

#### Configure and run

1. In a second PowerShell terminal in `backend`, set a long random token and start the API so other devices on your private LAN can reach it:

   ```powershell
   $env:PAPERLENS_DEVICE_TOKEN = "replace-with-a-long-random-token"
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

   Keep this token private. Allow Python through Windows Firewall on **Private networks** if prompted. Do not expose port 8000 to the public internet.
2. Find the computer's active Wi-Fi IPv4 address with `ipconfig`. The ESP32 and computer must be on the same Wi-Fi network; guest Wi-Fi or client isolation may block communication.
3. In `firmware/PaperLensDisplay`, copy `config.example.h` to `config.h`. Set your Wi-Fi name/password, the computer's URL (for example `http://192.168.1.25:8000/api/device/status`), and the exact same token as `PAPERLENS_DEVICE_TOKEN`. `config.h` is ignored by Git.
4. In Arduino IDE, install Espressif's ESP32 board support plus the **Adafruit SSD1306**, **Adafruit GFX Library**, and **ArduinoJson** libraries. Open `PaperLensDisplay.ino`, select your ESP32 board and COM port, and upload over USB.
5. Start the frontend as described below, upload a PDF, and use the ESP32's BOOT button to browse the OLED pages. The status display reports Wi-Fi/API errors and analysis failures.

The device status is held in backend memory and represents the latest submitted PDF; it resets when the API restarts. An analysis failure is shown on the OLED. A bad file rejected before analysis starts remains an error in the browser and does not replace the device's current status.

The analysis always uses the included local rule-based extractor. For the ESP32 only, set `PAPERLENS_DEVICE_TOKEN` in the backend terminal as described above; this secures the local status endpoint and is not an external API credential.

### 2. Start the frontend

```powershell
cd frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173>.

The frontend expects the API at `http://127.0.0.1:8000`. To use another backend URL, define `VITE_API_URL` in the frontend environment before starting Vite.

## API

- `GET /health` — service status and local analysis mode.
- `POST /api/analyze` — multipart form upload with a `file` field containing a PDF.
- `GET /api/device/status` — latest analysis status for the ESP32; requires the `X-Device-Token` header matching `PAPERLENS_DEVICE_TOKEN`.

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
firmware/
  PaperLensDisplay/
    PaperLensDisplay.ino
    config.example.h
```
