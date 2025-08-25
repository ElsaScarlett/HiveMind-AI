HiveMind AI

HiveMind AI is a multi-agent chat that runs local open-source models (via Ollama) so you can collaborate with multiple AIs at once, privately, with document upload and unlimited-length responses (via file-sink). It’s designed to be easy to install and run on a Mac, with optional cloud persistence using Turso.

Features

Multi-model collaboration (Llama 3.2, Mistral, Code Llama via Ollama)

Document upload (PDF, DOCX, code) and retrieval in chat

Broadcast, round-robin, and @mention dispatch modes

File-sink streaming for ultra-long outputs

“Clear chat” endpoints for privacy

Optional cloud database (Turso) for syncing across machines

Quick Start (macOS)

If you’ve never used Terminal before: copy each block below, paste into Terminal, press Enter, then wait until it finishes before doing the next block.

1) Clone the repository
git clone https://github.com/ElsaScarlett/HiveMind-AI.git
cd HiveMind-AI

2) Create your .env (server config)
cp .env.example .env

3) Install & start Ollama, pull a small model
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew update
brew install ollama
brew services start ollama
ollama pull llama3.2:3b

4) Install project dependencies
cd server
npm install
cd ..
cd client || true
npm install || true
cd ..

5) Start the server (backend)
cd server
node index.js


Leave this window open. You should see:
Server running on http://localhost:3001

6) Start the web app (frontend)

Open a new Terminal window:

cd HiveMind-AI/client
DISABLE_ESLINT_PLUGIN=true npm start


Your browser should open at: http://localhost:3000
(If your project uses Vite instead, go to apps/web and run npm run dev to open http://localhost:5173.)

One-Command Bootstrap (macOS)

This does steps 3–6 automatically.

cd HiveMind-AI
chmod +x scripts/bootstrap-mac.sh 2>/dev/null || true
./scripts/bootstrap-mac.sh
npm run dev


If npm run dev is not present, use the manual start commands in Quick Start above.

Reset / Clear History (Privacy)

To wipe local chats and uploads at any time:

cd HiveMind-AI
rm -f chat.db
rm -rf uploads/* uploads/outputs/*
mkdir -p uploads/outputs


If the app is running, you can also call the built-in endpoints:

Delete all messages

curl -X DELETE http://localhost:3001/api/messages


Delete a single message by ID

curl -X DELETE http://localhost:3001/api/messages/123


Clear everything (messages + uploads)

curl -X POST http://localhost:3001/api/clear-all

Optional: Use Turso (Cloud SQLite) for Sync

Using Turso lets you keep chats/projects synced across devices. If you don’t need sync, skip this section—local works fine.

A) Install the Turso CLI
brew install turso
turso auth signup
turso auth login

B) Create a database
turso db create hivemind-ai-db
turso db show hivemind-ai-db --url
turso db tokens create hivemind-ai-db


Copy the URL and token printed by those commands.

C) Configure the app to use Turso
cd HiveMind-AI
cp .env.example .env


Open .env and set:

PORT=3001
OLLAMA_BASE_URL=http://localhost:11434
PERSIST=true
DATABASE_URL=<paste the Turso URL here>
TURSO_AUTH_TOKEN=<paste the token here>

D) Start the app using Turso
cd server
node index.js


You should see Connected to Turso cloud database in the logs.

If you want a fresh Turso DB (no old data), run:

turso db shell hivemind-ai-db -e "DELETE FROM messages;"

Troubleshooting

Server says “Cannot GET /” at :3001
That’s normal: :3001 is the API only. Start the frontend and open http://localhost:3000 (or Vite :5173).

Frontend ESLint error
Use:

DISABLE_ESLINT_PLUGIN=true npm start


Ollama not running

brew services restart ollama
ollama serve
ollama pull llama3.2:3b


Hugging Face providers 404
If you aren’t using HF right now, disable those providers in server/providers.js or ignore the warnings.

Ports already in use

lsof -i :3001
kill -9 <PID>

How to Use

Open the web app and type your question.

Select which models (agents) should respond.

Upload documents to reference them in chat.

Use modes: “broadcast” to ask all, “round robin” to rotate, or @agent to mention one.

For very long answers, the app spills over to a downloadable file (file-sink).

Development Notes

Server runs on Node.js (Express), DB defaults to local SQLite, supports Turso.

Models come from Ollama (Llama 3.2, Mistral, Code Llama, etc.).

Frontend is React (Create React App) by default.

Local privacy by design: .gitignore excludes chat.db and uploads/.

Common Commands (copy-paste)

Clone + run

git clone https://github.com/ElsaScarlett/HiveMind-AI.git
cd HiveMind-AI
cp .env.example .env
cd server
npm install
node index.js


Start frontend (CRA)

cd HiveMind-AI/client
npm install
DISABLE_ESLINT_PLUGIN=true npm start


Install Ollama + pull model

brew install ollama
brew services start ollama
ollama pull llama3.2:3b


Reset local data

cd HiveMind-AI
rm -f chat.db
rm -rf uploads/* uploads/outputs/*
mkdir -p uploads/outputs


Use Turso (create + configure)

brew install turso
turso auth login
turso db create hivemind-ai-db
turso db show hivemind-ai-db --url
turso db tokens create hivemind-ai-db

License

HiveMind AI is licensed under the Apache 2.0 License
.
© 2025 ElsaScarlett
