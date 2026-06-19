# Goblin Operator

Connect any Zendesk and operate it by chat: real-time connect + workspace scan, then a
verify-gated agent (search / triage / update / bulk actions) with an embodied handoff.

Front-end: Vite + React + Tailwind + shadcn, built on the **notio** design system
(orb backgrounds, Geist, Base-UI primitives). Backend: serverless `/api` functions
(`scan`, `agent`, `warm`) — provider-pluggable (Anthropic or any OpenAI-compatible
endpoint via `OPERATOR_PROVIDER=openai`). The agent brain runs on a self-hosted
Qwen vLLM server on Modal (`modal/operator_llm.py`).

Dev: `npm install && npm run dev`. Vercel builds `dist` and serves `/api` as functions.
Env (Production): OPERATOR_PROVIDER, OPERATOR_BASE_URL, OPERATOR_API_KEY, OPERATOR_MODEL.
