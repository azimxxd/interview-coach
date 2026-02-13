# Voice Server (PersonaPlex Full Voice Mode)

This app is expected to run in **proxy mode** against NVIDIA `moshi.server`.
For full voice mode, `PERSONAPLEX_MOCK=0` alone is not enough.

## 1) Install proxy dependencies (once)

```bash
cd voice_server
python3 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

## 2) Start PersonaPlex/Moshi (terminal A)

Use your existing PersonaPlex checkout:

```bash
cd ~/personaplex
source .venv/bin/activate
hf auth login
SSL_DIR=$(mktemp -d)
python -m moshi.server --ssl "$SSL_DIR" --device cpu
```

If you have a small GPU and CPU offload support installed, try this first:

```bash
python -m moshi.server --ssl "$SSL_DIR" --device cuda --cpu-offload
```

## 3) Start this proxy server (terminal B)

```bash
cd /home/azimxd/projects/interview-coach/voice_server
source venv/bin/activate
export PERSONAPLEX_PROXY_URL="https://127.0.0.1:8998/api/chat?voice_prompt=NATF2.pt&text_prompt=You%20are%20a%20wise%20and%20friendly%20teacher.%20Ask%20one%20short%20interview%20question."
export MOSHI_INSECURE=1
uvicorn main:app --host 127.0.0.1 --port 8008
```

## 4) Start web app (terminal C)

```bash
cd /home/azimxd/projects/interview-coach
npm run dev
```

Open `http://127.0.0.1:3000`.

## 5) Verify ports

```bash
ss -ltnp | rg ':8998|:8008|:3000'
```

You should see all three ports listening.

## Runtime notes

- CPU mode is slow. First coach turn can take **2-3 minutes**.
- Proxy endpoint used by frontend: `ws://127.0.0.1:8008/ws`
- If voice stalls, restart both backend processes (`8998` then `8008`) and retry.
