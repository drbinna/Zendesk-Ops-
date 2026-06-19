# Operator LLM on Modal (vLLM, OpenAI-compatible)

Self-hosted open-model brain for the Goblin Operator. Scale-to-zero — you pay
only while it's serving a request (plus a short warm window).

## Deploy
```bash
pip install modal && modal setup
modal secret create operator-llm-key VLLM_API_KEY=<pick-a-strong-random-key>
modal deploy modal/operator_llm.py        # copy the printed https://...modal.run URL
```

## Smoke-test the endpoint (does it do tool calls?)
```bash
curl -s https://<your>--goblin-operator-llm-serve.modal.run/v1/chat/completions \
  -H "authorization: Bearer <VLLM_API_KEY>" -H "content-type: application/json" \
  -d '{"model":"Qwen/Qwen2.5-7B-Instruct","messages":[{"role":"user","content":"Say hi in 3 words."}]}'
```
First call cold-starts (downloads + loads weights, ~1–2 min once; cached after).

## Point the Operator at it (Vercel env → Production, then Redeploy)
```
OPERATOR_PROVIDER = openai
OPERATOR_BASE_URL = https://<your>--goblin-operator-llm-serve.modal.run/v1
OPERATOR_API_KEY  = <the same VLLM_API_KEY>
OPERATOR_MODEL    = Qwen/Qwen2.5-7B-Instruct
```

## Tuning
- **Stronger tool use:** `MODEL_NAME = "Qwen/Qwen2.5-32B-Instruct"`, `GPU = "A100-80GB"`.
- **No cold start for a demo:** add `min_containers=1` to the `@app.function(...)` (pays for idle GPU).
- **OOM on load:** lower `MAX_MODEL_LEN` (e.g. 8192) or `--gpu-memory-utilization`.
- Versions (`vllm==0.6.6`, `scaledown_window`, `@modal.concurrent`) reflect current Modal/vLLM; bump if your CLI warns.
