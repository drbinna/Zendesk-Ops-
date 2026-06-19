"""
Goblin Operator — self-hosted LLM brain on Modal (vLLM, OpenAI-compatible).

Serves an open model behind an OpenAI-compatible /v1 API with function calling,
so the Operator (api/agent.js, OPERATOR_PROVIDER=openai) can use it instead of
the Claude API. Scale-to-zero: you pay only while it's actually serving.

Deploy:
    pip install modal && modal setup
    modal secret create operator-llm-key VLLM_API_KEY=<pick-a-strong-random-key>
    modal deploy modal/operator_llm.py      # prints the web URL

Then in Vercel env (Production) + redeploy:
    OPERATOR_PROVIDER = openai
    OPERATOR_BASE_URL = https://<your>--goblin-operator-llm-serve.modal.run/v1
    OPERATOR_API_KEY  = <the same VLLM_API_KEY>
    OPERATOR_MODEL    = Qwen/Qwen2.5-7B-Instruct
"""

import modal

# --- knobs ---------------------------------------------------------------
# 7B on an A10G is the cheap/fast default and good enough for these tools.
# For stronger multi-step tool use: Qwen/Qwen2.5-32B-Instruct + GPU "A100-80GB".
MODEL_NAME = "Qwen/Qwen2.5-7B-Instruct"
GPU = "A10G"
N_GPU = 1
MAX_MODEL_LEN = 16384
PORT = 8000
# Keep-warm: 1 = one GPU always running (no cold start, instant responses, but you
# pay for the idle GPU ~24/7). 0 = scale to zero (cheap, but ~90s cold start when idle).
# Flip to 1 for demos / active use; back to 0 when you're done to stop idle cost.
MIN_CONTAINERS = 1
# ------------------------------------------------------------------------

vllm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("vllm==0.6.6", "huggingface_hub[hf_transfer]==0.27.0")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

# Cache model weights + vLLM compile cache across cold starts so we don't
# re-download multi-GB weights every time.
hf_cache = modal.Volume.from_name("hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("vllm-cache", create_if_missing=True)

app = modal.App("goblin-operator-llm")


@app.function(
    image=vllm_image,
    gpu=f"{GPU}:{N_GPU}",
    # Keep one GPU hot so there's no cold start (see MIN_CONTAINERS above).
    min_containers=MIN_CONTAINERS,
    scaledown_window=300,
    timeout=20 * 60,
    volumes={"/root/.cache/huggingface": hf_cache, "/root/.cache/vllm": vllm_cache},
    secrets=[modal.Secret.from_name("operator-llm-key")],  # provides VLLM_API_KEY
)
@modal.concurrent(max_inputs=8)  # one GPU serves several chat requests at once
@modal.web_server(port=PORT, startup_timeout=15 * 60)
def serve():
    import os
    import subprocess

    cmd = [
        "vllm", "serve", MODEL_NAME,
        "--host", "0.0.0.0", "--port", str(PORT),
        "--api-key", os.environ["VLLM_API_KEY"],
        "--served-model-name", MODEL_NAME,
        "--enable-auto-tool-choice",          # turn on function calling
        "--tool-call-parser", "hermes",       # Qwen2.5's tool-call format
        "--max-model-len", str(MAX_MODEL_LEN),
        "--gpu-memory-utilization", "0.90",
    ]
    subprocess.Popen(" ".join(cmd), shell=True)
