import argparse
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Union
import time
import json
import mlx.core as mx
from mlx_lm import load, stream_generate
from sentence_transformers import SentenceTransformer

app = FastAPI(title="FRAKTAG Unified Runner (MLX + Embeddings)")

# ==========================================
# STATE MANAGEMENT
# ==========================================
class EngineState:
    def __init__(self):
        # Chat Model (Lazy loaded, hot-swappable)
        self.chat_model = None
        self.tokenizer = None
        self.chat_model_path = None

        # Embedding Model (Loaded on startup, stays in memory)
        print("🔹 Initializing Embedding Model (Nomic-Embed)...")
        self.embed_model = SentenceTransformer("nomic-ai/nomic-embed-text-v1.5", trust_remote_code=True, device="mps")
        print("✅ Embedding Model Ready")

    def load_chat_model(self, model_path: str):
        if self.chat_model_path == model_path:
            return

        print(f"🔄 Loading Chat Model: {model_path}...")
        if self.chat_model:
            # Force cleanup of old model
            del self.chat_model
            del self.tokenizer
            mx.metal.clear_cache()

        self.chat_model, self.tokenizer = load(model_path)
        self.chat_model_path = model_path
        print(f"✅ Chat Model Loaded: {model_path}")

state = EngineState()

# ==========================================
# SCHEMAS
# ==========================================
class ChatMessage(BaseModel):
    role: str
    content: str

class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    max_tokens: Optional[int] = 4096
    temperature: Optional[float] = 0.1
    stream: Optional[bool] = False

class EmbeddingRequest(BaseModel):
    model: Optional[str] = "nomic-embed-text"
    input: Union[str, List[str]]

# ==========================================
# ENDPOINTS
# ==========================================

@app.post("/v1/chat/completions")
async def chat_completions(req: ChatCompletionRequest):
    state.load_chat_model(req.model)

    # Template application
    if hasattr(state.tokenizer, "apply_chat_template") and state.tokenizer.chat_template:
        prompt = state.tokenizer.apply_chat_template(
            [m.dict() for m in req.messages],
            tokenize=False,
            add_generation_prompt=True
        )
    else:
        prompt = "\n".join([f"{m.role}: {m.content}" for m in req.messages]) + "\nassistant:"

    if req.stream:
        return StreamingResponse(generate_stream(prompt, req.max_tokens, req.temperature), media_type="text/event-stream")

    # Non-streaming
    response_text = ""
    for response in stream_generate(state.chat_model, state.tokenizer, prompt, max_tokens=req.max_tokens, temp=req.temperature):
        response_text += response.text

    return {
        "id": f"chatcmpl-{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": req.model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": response_text}, "finish_reason": "stop"}]
    }

@app.post("/v1/embeddings")
async def create_embeddings(req: EmbeddingRequest):
    # Nomic expects "search_document: " prefix for docs and "search_query: " for queries
    # FRAKTAG sends raw text. For simplicity in RAG, we treat everything as documents or queries based on internal logic?
    # Actually, sentence-transformers handles generic input well.
    # Nomic v1.5 specific: 
    # To get best performance, you should prefix. 
    # But for drop-in replacement, we'll process as is or add a generic prefix.

    inputs = [req.input] if isinstance(req.input, str) else req.input

    # Prefixing helps Nomic performance (v1.5 specific)
    # We assume 'search_document' for generic usage to align with storage
    prefixed_inputs = [f"search_document: {text}" for text in inputs]

    vectors = state.embed_model.encode(prefixed_inputs, convert_to_numpy=True).tolist()

    data = []
    for i, vec in enumerate(vectors):
        data.append({
            "object": "embedding",
            "embedding": vec,
            "index": i
        })

    return {
        "object": "list",
        "data": data,
        "model": req.model,
        "usage": {"prompt_tokens": 0, "total_tokens": 0}
    }

async def generate_stream(prompt, max_tokens, temp):
    response_id = f"chatcmpl-{int(time.time())}"
    for response in stream_generate(state.chat_model, state.tokenizer, prompt, max_tokens=max_tokens, temp=temp):
        chunk = {
            "id": response_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": state.chat_model_path,
            "choices": [{"index": 0, "delta": {"content": response.text}, "finish_reason": None}]
        }
        yield f"data: {json.dumps(chunk)}\n\n"
    yield "data: [DONE]\n\n"

@app.get("/v1/models")
async def list_models():
    return {"object": "list", "data": [{"id": state.chat_model_path or "loading", "object": "model"}]}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=11434, help="Port to run server on")
    args = parser.parse_args()

    print(f"🚀 Unified Apple Silicon Server running on http://127.0.0.1:{args.port}")
    print(f"   - Chat: MLX (Hot-Swap)")
    print(f"   - Embeddings: SentenceTransformers (Nomic-v1.5)")

    uvicorn.run(app, host="127.0.0.1", port=args.port)
