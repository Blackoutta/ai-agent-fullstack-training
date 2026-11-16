"""本机 OpenAI 兼容编码服务 + 重排服务，仅用于没有部署编码/重排集群时跑通教学脚本。

启动：
    HF_ENDPOINT=https://hf-mirror.com python -m lab.local_embedding_service
    # 或指定端口/模型
    EMBEDDING_PORT=8012 EMBEDDING_MODEL_PATH=BAAI/bge-small-zh-v1.5 python -m lab.local_embedding_service

端点：
    POST /v1/embeddings  {model, input}                      -> data:[{index, embedding}]
    POST /rerank         {model, query, documents, top_n}    -> results:[{index, relevance_score}]
    GET  /health

说明：
- 编码是真实权重（默认 bge-small-zh-v1.5，CPU 推理，512 维），不是确定性夹具；
- 重排是同一编码器的余弦相似度排序（bi-encoder），不是 cross-encoder 精排，
  分数只用于排序，不代表生产级相关性判断；
- 本机 CPU 推理的单进程服务，不具备生产吞吐、并发隔离与多副本能力。
"""
import os

import torch
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoModel, AutoTokenizer

MODEL_PATH = os.getenv('EMBEDDING_MODEL_PATH', 'BAAI/bge-small-zh-v1.5')
MAX_LENGTH = int(os.getenv('EMBEDDING_MAX_LENGTH', '512'))

tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
encoder = AutoModel.from_pretrained(MODEL_PATH).eval()

app = FastAPI(title='local-embedding-rerank')


class EmbeddingRequest(BaseModel):
    model: str | None = None
    input: str | list[str]


class RerankRequest(BaseModel):
    model: str | None = None
    query: str
    documents: list[str]
    top_n: int | None = None
    return_documents: bool = False


@torch.inference_mode()
def encode(texts):
    """CLS 池化 + L2 归一化，与 bge 官方用法一致。"""
    batch = tokenizer(texts, padding=True, truncation=True, max_length=MAX_LENGTH,
                      return_tensors='pt')
    hidden = encoder(**batch).last_hidden_state[:, 0]
    return torch.nn.functional.normalize(hidden, p=2, dim=1)


def tokens(texts):
    return sum(len(tokenizer(t).input_ids) for t in texts)


@app.get('/health')
def health():
    return {'status': 'ok', 'model': MODEL_PATH, 'dim': encoder.config.hidden_size}


@app.post('/v1/embeddings')
def embeddings(request: EmbeddingRequest):
    texts = [request.input] if isinstance(request.input, str) else list(request.input)
    if not texts or any(not isinstance(t, str) or not t.strip() for t in texts):
        raise ValueError('input 必须是非空字符串数组')
    vectors = encode(texts).tolist()
    used = tokens(texts)
    return {'object': 'list', 'model': request.model or MODEL_PATH,
            'data': [{'object': 'embedding', 'index': i, 'embedding': v} for i, v in enumerate(vectors)],
            'usage': {'prompt_tokens': used, 'total_tokens': used}}


@app.post('/rerank')
def rerank(request: RerankRequest):
    if not request.documents:
        raise ValueError('documents 不能为空')
    vectors = encode([request.query] + list(request.documents))
    scores = (vectors[1:] @ vectors[0]).tolist()
    order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    if request.top_n:
        order = order[:request.top_n]
    return {'model': request.model or MODEL_PATH,
            'results': [{'index': i, 'relevance_score': float(scores[i])} for i in order]}


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(app, host=os.getenv('EMBEDDING_HOST', '127.0.0.1'),
                port=int(os.getenv('EMBEDDING_PORT', '8012')), log_level='warning')
