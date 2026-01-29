# Interview Coach (MVP)

Practice interviews with live delivery signals and structured feedback. The app runs entirely in the browser: no raw video or audio is stored, only transcript + aggregated metrics.

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Browser requirements

- Chrome recommended (Web Speech API support for live transcription).
- Camera + microphone permissions required to collect delivery signals.

## OpenAI (optional)

The app works without any API keys and uses a mock AI response by default.

To enable OpenAI:

1. Copy `.env.example` to `.env.local`.
2. Add your key:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

## Demo flow

1. Start on `/` and choose role/level/language.
2. Click **Start interview**.
3. Allow camera/mic permissions.
4. Click **Next question**.
5. Click **Start answer recording**.
6. Click **Stop & evaluate**.
7. After 8 questions, click **Finish interview** to view the report.

## Privacy notes

- Raw video/audio is never stored.
- Only transcript + aggregated metrics are stored in memory unless you toggle "Store session locally".
