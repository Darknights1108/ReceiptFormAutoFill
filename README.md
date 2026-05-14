# Receipt Form Auto-Fill

A simple web app that uploads a receipt image, uses a vision-capable AI model to extract receipt fields, and fills an editable review form.

Extracted fields:

- Merchant name
- Date
- Total amount
- Currency

## Requirements

- Node.js 18 or newer
- A vision-capable OpenAI-compatible API key

No npm packages are required for this project.

## Setup

Clone the repository and enter the project folder:

```powershell
git clone <your-repository-url>
cd ReceiptFormAutoFill
```

Create a `.env` file:

```powershell
Copy-Item .env.example .env
```

Fill in the API settings in `.env`:

```text
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://token-plan-sgp.xiaomimimo.com/v1
OPENAI_MODEL=mimo-v2-omni
OPENAI_API_MODE=chat
PORT=3000
```

For local demo/testing, a private API key may already be placed in the local `.env` file. If that key does not work or has expired, replace `OPENAI_API_KEY` with your own API key.

When downloading from GitHub, `.env` is normally not included because it contains secrets. Use `.env.example` as the template and add your own key.

## Start The App

On Windows, use the included startup script:

```powershell
.\start-app.cmd
```

Then open:

```text
http://localhost:5173
```

To use another port:

```powershell
.\start-app.cmd 5181
```

The `start-app.cmd` and `start-app.ps1` files help Windows users start the app even when the `node` command is not added to PATH. Keep both files unless you are sure `node server.js` works on your machine.

If Node.js is already installed and available in PATH, you can also start the app directly:

```powershell
node server.js 5173
```

## How To Use

1. Open the app in the browser.
2. Upload a receipt image.
3. Click `Extract Fields`.
4. Review and edit the extracted values.
5. Click `Submit Reviewed Data`.

Submitted records are stored in the browser's local storage.
