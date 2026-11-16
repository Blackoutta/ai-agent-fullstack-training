
import asyncio
import contextvars
import copy
import json
import math
import os
import re
import threading
import time
import unicodedata
from collections import Counter
from pathlib import Path
from statistics import median

import httpx
from pydantic import PrivateAttr
from llama_index.core import VectorStoreIndex
from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.core.ingestion import IngestionCache, IngestionPipeline
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import Document, NodeWithScore, TextNode

from lab.caching import (ApprovedFAQCache, CachedEmbedding, Scope, TTLCache,
                         cached_read, cached_retrieve)
from lab.scheduler import Scheduler

ROOT = Path(__file__).resolve().parents[1]
QUESTION = '今年采购合同的违约金上限是多少？与去年模板相比变化多少？'
FAQ_QUESTION = '采购模板从哪下载？'
REVIEWED_QUESTION = '采购模板在哪里下载？'
SYSTEM = ('你是采购合同知识库助手，只使用本次提供的证据。返回JSON，不带代码围栏。'
          '合同对比返回current_percent、previous_percent、delta_pp，百分数填8而不是0.08；'
          '只有确认计算基数相同时才能比较，delta_pp=今年减去年。'
          '模板下载问题返回text。所有回答必须含citations数组，'
          '每项包含source_id、version、quote，quote必须逐字引用证据。证据不足时明确拒绝推断。')
WORK = contextvars.ContextVar('work', default=(False, None))


class Meter:
    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        self.counts = Counter()
        self.usage = Counter()
        self.times = Counter()
        self.usage_known = True
        self.peak = self.peak_bg = self.active = self.active_bg = 0

    def add(self, key, value=1):
        with self.lock:
            self.counts[key] += value

    def add_time(self, key, seconds):
        with self.lock:
            self.times[key] += seconds

    def ms(self, key):
        return round(self.times.get(key, 0.0)*1000, 1)

    def tokens(self, usage):
        with self.lock:
            if not usage or any(usage.get(k) is None for k in ('prompt_tokens', 'completion_tokens')):
                self.usage_known = False
                return
            self.usage['input'] += usage['prompt_tokens']
            self.usage['output'] += usage['completion_tokens']

    def snapshot(self):
        return dict(self.counts)


def fixture_answer(messages):
    """Fixed protocol data: never presented as a model's reasoning or GPU result."""
    payload = json.loads(messages[-1]['content'])
    evidence = payload['evidence']
    if '模板' in payload['question'] and '下载' in payload['question']:
        selected = [e for e in evidence if e['id'] == 'portal']
        answer = {'text': '在内网门户 /procurement/templates 下载。'}
    else:
        selected = [e for e in evidence if e['id'] in ('current-v3-clause-8', 'template-2025-clause-8')]
        # Extract the numbers from the supplied evidence, rather than a cache switch.
        values = {e['id']: int(re.search(r'(\d+)%', e['text']).group(1)) for e in selected}
        current, previous = values.get('current-v3-clause-8'), values.get('template-2025-clause-8')
        answer = dict(current_percent=current, previous_percent=previous,
                      delta_pp=current-previous if current is not None and previous is not None else None)
    answer['citations'] = [dict(source_id=e['id'], version=e['version'], quote=e['text']) for e in selected]
    return answer


class Backend:
    def __init__(self, fixture=False):
        self.fixture = fixture
        self.meter = Meter()
        self.gate = None
        self.base = os.getenv('LITELLM_API_BASE', 'http://127.0.0.1:4000/v1').rstrip('/')
        self.key = os.getenv('LITELLM_API_KEY')
        # 编码、重排可以不是同一个服务：未配置时沿用生成端点与凭证。
        self.embedding_base = os.getenv('EMBEDDING_API_BASE', self.base).rstrip('/')
        self.embedding_model = os.getenv('EMBEDDING_MODEL', 'rag-embedding')
        self.revision = ('fixture-concept-vector-v1' if fixture else os.getenv('EMBEDDING_REVISION', ''))
        if not fixture and (not self.key or not self.revision):
            raise ValueError('请设置 LITELLM_API_KEY、EMBEDDING_REVISION，并确认已启动编码、生成和重排服务。')
        self.sync = httpx.Client(timeout=30, trust_env=False)
        self.client = httpx.AsyncClient(timeout=30, trust_env=False)

    def require_local_services(self):
        """本机端点没启动时给出可执行的提示；远端端点交给真实请求报错。"""
        if not re.match(r'^https?://(127\.0\.0\.1|localhost)[:/]', self.embedding_base):
            return
        origin = '/'.join(self.embedding_base.split('/')[:3])
        try:
            self.sync.get(origin+'/health', timeout=3).raise_for_status()
        except Exception as error:
            raise ValueError('本机编码/重排服务未启动：先另开一个终端运行 '
                             'python -m lab.local_embedding_service') from error

    @staticmethod
    def auth(key):
        return {'Authorization': 'Bearer '+(key or 'fixture-not-a-key')}

    @property
    def headers(self):
        return self.auth(self.key)

    @property
    def embedding_headers(self):
        return self.auth(os.getenv('EMBEDDING_API_KEY') or self.key)

    @property
    def rerank_headers(self):
        return self.auth(os.getenv('RERANK_API_KEY') or self.key)

    @staticmethod
    def fixture_vector(text):
        # Concept buckets intentionally make the two teaching FAQ paraphrases equal.
        return [float('下载' in text), float('违约' in text), float('2026' in text or '今年' in text),
                float('2025' in text or '去年' in text), 1.]

    @staticmethod
    def ordered_vectors(body, count):
        rows = sorted(body['data'], key=lambda row: row['index'])
        if [r['index'] for r in rows] != list(range(count)):
            raise ValueError('编码结果数量或index不匹配')
        vectors = [r['embedding'] for r in rows]
        if not vectors or any(not v or any(not math.isfinite(x) for x in v) for v in vectors):
            raise ValueError('无效向量')
        return vectors

    def embed_sync(self, texts):
        self.meter.add('embedding_requests')
        self.meter.add('embedding_texts', len(texts))
        if self.fixture:
            return [self.fixture_vector(t) for t in texts]
        started = time.perf_counter()
        response = self.sync.post(self.embedding_base+'/embeddings', headers=self.embedding_headers,
                                  json={'model': self.embedding_model, 'input': texts})
        response.raise_for_status()
        vectors = self.ordered_vectors(response.json(), len(texts))
        self.meter.add_time('embedding', time.perf_counter()-started)
        return vectors

    async def operation(self, fn):
        background, deadline = WORK.get()

        async def execute():
            self.meter.active += 1
            self.meter.active_bg += int(background)
            self.meter.peak = max(self.meter.peak, self.meter.active)
            self.meter.peak_bg = max(self.meter.peak_bg, self.meter.active_bg)
            try:
                return await fn()
            finally:
                self.meter.active -= 1
                self.meter.active_bg -= int(background)

        if self.gate is None:
            return await execute()
        # The serial control has one shared slot. Background remains measurable
        # but is not marked as reserved-capacity work in this one-slot control.
        return await self.gate.submit(execute, priority=10 if background else 0,
                                      background=background and self.gate.concurrency > 1,
                                      deadline=deadline)

    async def aembed(self, texts):
        async def work():
            self.meter.add('embedding_requests')
            self.meter.add('embedding_texts', len(texts))
            if self.fixture:
                await asyncio.sleep(.015)
                return [self.fixture_vector(t) for t in texts]
            started = time.perf_counter()
            response = await self.client.post(self.embedding_base+'/embeddings', headers=self.embedding_headers,
                                               json={'model': self.embedding_model, 'input': texts})
            response.raise_for_status()
            vectors = self.ordered_vectors(response.json(), len(texts))
            self.meter.add_time('embedding', time.perf_counter()-started)
            return vectors
        return await self.operation(work)

    async def rerank(self, question, nodes):
        async def work():
            self.meter.add('rerank_requests')
            if self.fixture:
                await asyncio.sleep(.015)
                return nodes
            url, model = os.getenv('RERANK_URL'), os.getenv('RERANK_MODEL')
            if not url or not model:
                raise ValueError('请设置 RERANK_URL 和 RERANK_MODEL')
            started = time.perf_counter()
            response = await self.client.post(url, headers=self.rerank_headers, json={
                'model': model, 'query': question, 'documents': [n.node.text for n in nodes],
                'top_n': len(nodes), 'return_documents': False})
            response.raise_for_status()
            rows = response.json()['results']
            indices = [r['index'] for r in rows]
            if len(set(indices)) != len(indices) or any(type(i) is not int or not 0 <= i < len(nodes) for i in indices):
                raise ValueError('重排index不匹配')
            if any(not math.isfinite(r['relevance_score']) for r in rows):
                raise ValueError('重排分数无效')
            ranked = [NodeWithScore(node=nodes[r['index']].node, score=r['relevance_score']) for r in rows]
            self.meter.add_time('rerank', time.perf_counter()-started)
            return ranked
        return await self.operation(work)

    async def generate(self, question, evidence, prefix=SYSTEM):
        messages = [{'role': 'system', 'content': prefix}, {'role': 'user', 'content': json.dumps(
            {'question': question, 'evidence': evidence}, ensure_ascii=False)}]

        async def work():
            self.meter.add('generation_requests')
            if self.fixture:
                await asyncio.sleep(.025)
                self.meter.tokens(None)
                return fixture_answer(messages), None
            started = time.perf_counter()
            budget = int(os.getenv('DEMO_MAX_TOKENS', '700'))
            payload = {'model': os.getenv('DEMO_CHAT_MODEL', 'rag-capable'), 'messages': messages,
                       'temperature': 0, 'max_tokens': budget,
                       'stream': False, 'cache': {'no-cache': True, 'no-store': True}}
            effort = os.getenv('DEMO_REASONING_EFFORT')
            if effort:
                # 推理型模型的思考 token 也计入 max_tokens；降档能明显缩短思考长度。
                payload['reasoning_effort'] = effort
            response = await self.client.post(self.base+'/chat/completions', headers=self.headers,
                                              json=payload)
            response.raise_for_status()
            body = response.json()
            choice = body['choices'][0]
            # 推理型模型会把思考 token 算进 max_tokens；截断时必须报错，不能当成格式错误。
            if choice.get('finish_reason') == 'length':
                usage = body.get('usage') or {}
                raise ValueError('生成达到 max_tokens({}) 被截断（思考 {} token），'
                                 '请提高 DEMO_MAX_TOKENS 或降低 DEMO_REASONING_EFFORT 后重试'.format(
                                     budget, (usage.get('completion_tokens_details') or {}).get('reasoning_tokens', '未知')))
            content = choice['message']['content'].strip()
            if content.startswith('```'):
                content = re.sub(r'^```(?:json)?\s*|\s*```$', '', content)
            self.meter.tokens(body.get('usage'))
            answer = json.loads(content)
            self.meter.add_time('generation', time.perf_counter()-started)
            return answer, body.get('usage')
        return await self.operation(work)

    async def close(self):
        self.sync.close()
        await self.client.aclose()


class MeasuredEmbedding(BaseEmbedding):
    _backend: object = PrivateAttr()

    def __init__(self, backend):
        super().__init__(model_name=backend.embedding_model, embed_batch_size=8)
        self._backend = backend

    def _get_query_embedding(self, text): return self._backend.embed_sync([text])[0]
    def _get_text_embedding(self, text): return self._backend.embed_sync([text])[0]
    def _get_text_embeddings(self, texts): return self._backend.embed_sync(texts)
    async def _aget_query_embedding(self, text): return (await self._backend.aembed([text]))[0]
    async def _aget_text_embedding(self, text): return (await self._backend.aembed([text]))[0]
    async def _aget_text_embeddings(self, texts): return await self._backend.aembed(texts)


class Corpus:
    def __init__(self):
        self.scope = Scope('tenant-a', 'server-acl-v1', 'contracts-v3-index1', 'faq-policy1')
        self.nodes = {}
        self.revoked = set()
        for doc in json.loads((ROOT/'data/contracts.json').read_text()):
            if doc['tenant'] == self.scope.tenant:
                for c in doc['chunks']:
                    self.nodes[c['id']] = TextNode(id_=c['id'], text=c['text'],
                        metadata={'tenant': doc['tenant'], 'version': doc['id']})
        self.nodes['portal'] = TextNode(id_='portal', text='采购模板在内网门户 /procurement/templates 下载。',
            metadata={'tenant': self.scope.tenant, 'version': 'portal-v1'})

    def load(self, sid, scope):
        if scope.tenant != self.scope.tenant or scope.access != self.scope.access or sid in self.revoked:
            raise PermissionError('当前用户无权访问该来源')
        node = self.nodes[sid]
        if node.metadata['tenant'] != scope.tenant:
            raise PermissionError('来源租户不匹配')
        return node

    def authorize(self, sid, scope):
        node = self.load(sid, scope)
        return {'id': sid, 'tenant': node.metadata['tenant'], 'version': node.metadata['version']}

    def fetch(self, sid, version, scope):
        # The demo's versioned source is an actual local JSON file.
        node = self.load(sid, scope)
        if version != node.metadata['version']:
            raise ValueError('来源版本已改变')
        if sid == 'portal':
            return node.text
        for doc in json.loads((ROOT/'data/contracts.json').read_text()):
            if doc['tenant'] == scope.tenant and doc['id'] == version:
                for chunk in doc['chunks']:
                    if chunk['id'] == sid:
                        return chunk['text']
        raise ValueError('指定版本来源不存在')

    def validate(self, answer, faq=False):
        citations = answer.get('citations', [])
        if not citations:
            raise ValueError('答案缺少引用')
        ids = set()
        for c in citations:
            node = self.load(c['source_id'], self.scope)
            if c.get('version') != node.metadata['version'] or not c.get('quote') or c['quote'] not in node.text:
                raise ValueError('答案引用或版本不成立')
            ids.add(c['source_id'])
        if faq:
            if 'portal' not in ids or '/procurement/templates' not in answer.get('text', ''):
                raise ValueError('模板下载答案不符合教学验收条件')
        elif (answer.get('current_percent'), answer.get('previous_percent'), answer.get('delta_pp')) != (8, 10, -2) or not {
                'current-v3-clause-8', 'template-2025-clause-8'}.issubset(ids):
            raise ValueError('合同对比答案不符合教学验收条件：current={} previous={} delta={} citations={}'.format(
                answer.get('current_percent'), answer.get('previous_percent'), answer.get('delta_pp'),
                sorted(ids)))


async def generate_validated(backend, corpus, question, evidence, prefix=SYSTEM, faq=False):
    """模型偶尔会漏字段或引用：重试次数可配，重试会提示且照旧计入生成次数。"""
    retries = int(os.getenv('DEMO_VALIDATION_RETRIES', '1'))
    for attempt in range(retries + 1):
        answer, usage = await backend.generate(question, evidence, prefix)
        try:
            corpus.validate(answer, faq=faq)
            return answer, usage
        except ValueError as error:
            if attempt == retries:
                raise
            print('提示：'+str(error)+'；重新生成一次。')


class RetrievalOrchestrator:
    """Cache this full stage to bypass both vector retrieval and reranking."""
    def __init__(self, retriever, backend):
        self.retriever, self.backend = retriever, backend

    async def aretrieve(self, question):
        self.backend.meter.add('retrieval_requests')
        hits = await self.retriever.aretrieve(question)
        return await self.backend.rerank(question, hits)


class DemoRAG:
    def __init__(self, backend, corpus=None, layer='none', nodes=None, initialize=True):
        self.backend, self.corpus, self.layer = backend, corpus or Corpus(), layer
        self.cache = TTLCache()
        base = MeasuredEmbedding(backend)
        self.embed = (CachedEmbedding(base, self.cache, self.corpus.scope, backend.revision,
                                     embed_batch_size=8) if layer == 'embedding' else base)
        self.nodes = nodes or [n for sid, n in self.corpus.nodes.items() if sid != 'portal']
        if initialize:
            self.build()

    def build(self):
        # Copy nodes: never reuse mutated per-node embedding state across controls.
        self.index = VectorStoreIndex([n.model_copy(deep=True) for n in self.nodes], embed_model=self.embed)
        self.retriever = RetrievalOrchestrator(self.index.as_retriever(similarity_top_k=len(self.nodes)), self.backend)

    def reviewed_answer(self):
        n = self.corpus.nodes['portal']
        return {'text': '在内网门户 /procurement/templates 下载。', 'citations': [
            {'source_id': 'portal', 'version': 'portal-v1', 'quote': n.text}]}

    def prepare_faq(self):
        self.faq = ApprovedFAQCache()
        self.faq.approve(scope=self.corpus.scope, intent='template-location', question=REVIEWED_QUESTION,
            answer=self.reviewed_answer(), vector=self.embed.get_query_embedding(REVIEWED_QUESTION),
            space_id=self.backend.revision, reviewer='已人工审阅的教学资料', source_loader=self.corpus.load)

    def evidence(self, hits):
        rows = []
        for hit in hits:
            sid = hit.node.node_id
            def fetch(sid, version, scope):
                self.backend.meter.add('body_reads')
                started = time.perf_counter()
                try:
                    return self.corpus.fetch(sid, version, scope)
                finally:
                    self.backend.meter.add_time('body_read', time.perf_counter()-started)
            if self.layer == 'tool':
                row = cached_read(sid, self.corpus.scope, self.cache, self.corpus.authorize, fetch)
            else:
                ref = self.corpus.authorize(sid, self.corpus.scope)
                row = {'source_id': sid, 'version': ref['version'],
                       'text': fetch(sid, ref['version'], self.corpus.scope)}
            rows.append({'id': sid, 'text': row['text'], 'version': row['version']})
        return rows

    async def ask(self, question=QUESTION, faq=False):
        if self.layer == 'semantic' and faq:
            vector = await self.embed.aget_query_embedding(question)
            answer = self.faq.lookup(scope=self.corpus.scope, intent='template-location', vector=vector,
                space_id=self.backend.revision, single_turn=True, source_loader=self.corpus.load)
            if answer is not None:
                self.corpus.validate(answer, faq=True)
                self.backend.meter.add('approved_answer_reuses')
                return answer
        if self.layer == 'rag':
            hits = await cached_retrieve(self.retriever, question, self.corpus.scope, self.cache,
                self.corpus.load, {'tenant': self.corpus.scope.tenant}, len(self.nodes),
                retrieval_revision=self.backend.revision+'|'+os.getenv('RERANK_MODEL', 'fixture-rerank-v1'))
        else:
            hits = await self.retriever.aretrieve(question)
        answer, _ = await generate_validated(self.backend, self.corpus, question, self.evidence(hits), faq=faq)
        return answer


class MeasuredSplitter(SentenceSplitter):
    _meter: object = PrivateAttr()

    def __init__(self, meter):
        super().__init__(chunk_size=256, chunk_overlap=16, include_metadata=False)
        self._meter = meter

    def __call__(self, *args, **kwargs):
        self._meter.add('split_calls')
        return super().__call__(*args, **kwargs)


def display_width(text):
    # 中文按 2 格算，否则终端里数字会和中文挤在一起。
    return sum(2 if unicodedata.east_asian_width(ch) in 'WF' else 1 for ch in text)


def table(headers, rows):
    grid = [[str(h) for h in headers]] + [[str(v) for v in row] for row in rows]
    widths = [max(display_width(row[i]) for row in grid) for i in range(len(headers))]
    for row in grid:
        line = '  '.join(cell+' '*(width-display_width(cell)) for cell, width in zip(row, widths))
        print(line.rstrip())


def token_text(meter):
    if not meter.usage_known:
        return '未知'
    return f"{meter.usage['input']}/{meter.usage['output']}"


def answer_text(answer):
    if 'current_percent' in answer:
        text = f"今年{answer['current_percent']}%，去年{answer['previous_percent']}%，变化{answer['delta_pp']}个百分点。"
    else:
        text = answer['text']
    return text+' 引用：'+ '、'.join(c['source_id'] for c in answer['citations'])


async def timed(backend, fn):
    backend.meter.reset()
    started = time.perf_counter()
    answer = await fn()
    total_ms = round((time.perf_counter()-started)*1000, 1)
    return answer, total_ms, backend.meter.snapshot(), token_text(backend.meter), backend.meter.ms('generation')


def summarize(samples):
    totals = [s[0] for s in samples]
    generations = [s[1] for s in samples]
    return (round(median(totals), 1), [min(totals), max(totals)],
            round(median(generations), 1), [min(generations), max(generations)])


async def warmup_layer(backend, layer, question, is_faq):
    """预热用独立实例，结果丢弃：消掉连接池、本机模型加载与服务端前缀缓存冷启动。"""
    corpus = Corpus()
    app = DemoRAG(backend, corpus, layer, [corpus.nodes['portal']] if is_faq else None)
    if is_faq:
        app.prepare_faq()
    try:
        await app.ask(question, faq=is_faq)
    except Exception:
        pass  # 预热失败不写入样本；真实错误会在正式样本里暴露
    backend.meter.reset()


async def cache_comparison(backend, layer, repeat=1):
    repeat = max(1, int(repeat))
    corpus = Corpus()
    is_faq = layer == 'semantic'
    nodes = [corpus.nodes['portal']] if is_faq else None
    question = FAQ_QUESTION if is_faq else QUESTION

    def make_cached():
        app = DemoRAG(backend, corpus, layer, nodes, initialize=layer != 'embedding')
        if is_faq:
            app.prepare_faq()  # 审阅/发布成本不计入在线请求
        return app

    async def measure(app):
        async def run():
            if layer == 'embedding':
                app.build()  # 重复入库；普通提问不会重编码整库
            return await app.ask(question, faq=is_faq)
        answer, total_ms, counts, tokens, generate_ms = await timed(backend, run)
        return total_ms, generate_ms, counts, tokens, answer

    control = DemoRAG(backend, corpus, nodes=nodes, initialize=layer != 'embedding')
    await warmup_layer(backend, layer, question, is_faq)

    cold = [await measure(control) for _ in range(repeat)]
    fresh = [make_cached() for _ in range(repeat)]
    first = [await measure(app) for app in fresh]  # 每个样本都是空缓存首次
    reused = [await measure(fresh[-1]) for _ in range(repeat)]  # 同实例后续调用，缓存已就绪

    rows, answers, observations = [], [], []
    # 缓存证据要求“跨样本完全一致”的只有这几项；生成次数可能因验收重试多一次。
    evidence_keys = ('embedding_requests', 'embedding_texts', 'retrieval_requests',
                     'rerank_requests', 'body_reads', 'approved_answer_reuses')
    for label, samples in [('关闭', cold), ('开启·首轮', first), ('开启·复用', reused)]:
        def signature(counts):
            return {key: counts.get(key, 0) for key in evidence_keys}
        if any(signature(sample[2]) != signature(samples[0][2]) for sample in samples):
            raise ValueError(label+' 重复采样计数不一致：缓存命中不稳定，不能当作命中证据')
        middle = sorted(samples, key=lambda sample: sample[0])[len(samples)//2]
        counts, tokens = middle[2], middle[3]
        retried = sum(1 for sample in samples
                      if sample[2].get('generation_requests', 0) != counts.get('generation_requests', 0))
        total_ms, total_range, generate_ms, generate_range = summarize([(s[0], s[1]) for s in samples])
        stage = [round(s[0]-s[1], 1) for s in samples]
        rows.append({'state': label, 'counts': counts, 'samples': len(samples), 'retried': retried,
                     'total_ms': total_ms, 'total_range': total_range,
                     'generate_ms': generate_ms, 'generate_range': generate_range,
                     'cache_stage_ms': round(median(stage), 1), 'cache_stage_range': [min(stage), max(stage)],
                     'tokens': tokens})
        answers.append(samples[-1][4])
        observations.append({**counts, 'samples': len(samples),
                             'cache_stage_ms': rows[-1]['cache_stage_ms'], 'generate_ms': generate_ms})
    return question, rows, answers, observations


async def ingestion_comparison(backend):
    corpus = Corpus()
    documents = [Document(id_=sid, text=n.text, metadata=n.metadata)
                 for sid, n in corpus.nodes.items() if sid != 'portal']
    cache = IngestionCache()
    rows, observations = [], []
    for label, disabled in [('关闭', True), ('开启·首轮', False), ('开启·复用', False)]:
        backend.meter.reset()
        pipeline = IngestionPipeline(transformations=[MeasuredSplitter(backend.meter), MeasuredEmbedding(backend)],
                                     cache=cache, disable_cache=disabled)
        start = time.perf_counter()
        nodes = await asyncio.to_thread(pipeline.run, documents=copy.deepcopy(documents))
        counts = backend.meter.snapshot()
        rows.append([label, round((time.perf_counter()-start)*1000, 1), counts.get('split_calls', 0),
                     counts.get('embedding_requests', 0), counts.get('embedding_texts', 0), len(nodes)])
        observations.append(counts)
    return rows, observations


async def prompt_comparison(backend):
    if backend.fixture:
        return None  # No fabricated inference-engine cache receipts.
    app = DemoRAG(backend)
    hits = await app.retriever.aretrieve(QUESTION)
    evidence = app.evidence(hits)
    # Keep a long stable prefix; actual reuse still depends on the server and cache state.
    prefix = SYSTEM + '\n' + ('保留计算基数、比例、否定、例外与原始引用；证据不足时停止推断。\n' * 100)
    rows, answers = [], []
    for label in ('首次请求', '重复前缀'):
        backend.meter.reset()
        start = time.perf_counter()
        answer, usage = await generate_validated(backend, app.corpus, QUESTION, evidence, prefix)
        details = (usage or {}).get('prompt_tokens_details') or {}
        cached = details.get('cached_tokens', (usage or {}).get('cache_read_input_tokens'))
        rows.append([label, round((time.perf_counter()-start)*1000, 1),
                     token_text(backend.meter), cached if cached is not None else '未知'])
        answers.append(answer)
    return rows, answers


def percentile(values, p=.95):
    if not values:
        return None
    return sorted(values)[max(0, math.ceil(len(values)*p)-1)]


async def mixed_load(backend, *, concurrency, batch_size, online_count=4, background_texts=40,
                     queue_timeout=2., request_timeout=12., deadline_seconds=30.):
    app = DemoRAG(backend)
    backend.meter.reset()
    gate = Scheduler(concurrency=concurrency, max_waiting=32,
                     background_limit=min(2, concurrency-1), queue_timeout=queue_timeout,
                     request_timeout=request_timeout)
    backend.gate = gate
    started = time.monotonic()
    deadline = started + deadline_seconds
    latencies, errors, answers = [], [], []
    online_ok = background_ok = 0

    async def online():
        nonlocal online_ok
        begin = time.monotonic()
        token = WORK.set((False, deadline))
        try:
            # One independent RAG request; actual downstream calls share the same gate.
            answer = await app.ask()
            answers.append(answer)
            online_ok += 1
            latencies.append((time.monotonic()-begin)*1000)
        except Exception as e:
            errors.append(type(e).__name__)
        finally:
            WORK.reset(token)

    async def background(texts):
        nonlocal background_ok
        token = WORK.set((True, deadline))
        try:
            await backend.aembed(texts)
            background_ok += len(texts)
        except Exception as e:
            errors.append(type(e).__name__)
        finally:
            WORK.reset(token)

    texts = [f'教学导入片段{i}：违约金累计上限为合同总额的8%。' for i in range(background_texts)]
    batches = iter(texts[i:i+batch_size] for i in range(0, len(texts), batch_size))
    async def producer():
        # Bound outstanding work too: a serial control must not enqueue all 40
        # single-item requests and overflow before online tasks can participate.
        for batch in batches:
            await background(batch)
    tasks = [asyncio.create_task(producer()) for _ in range(2)]
    await asyncio.sleep(0)  # Let background occupy its allowed capacity first.
    tasks += [asyncio.create_task(online()) for _ in range(online_count)]
    try:
        await asyncio.gather(*tasks)
    finally:
        await gate.close()
        backend.gate = None
    elapsed = time.monotonic()-started
    waits = [e['queue_ms'] for e in gate.events if e['event'] == 'start']
    return dict(concurrency=concurrency, batch_size=batch_size, elapsed_ms=round(elapsed*1000, 1),
                online_p95_ms=round(percentile(latencies), 1) if latencies else '未知',
                queue_p95_ms=round(percentile(waits), 1) if waits else '未知',
                online_ok=online_ok, online_total=online_count, background_ok=background_ok,
                background_total=background_texts, peak=backend.meter.peak, peak_bg=backend.meter.peak_bg,
                counts=backend.meter.snapshot(), errors=errors, answers=answers,
                all_results_valid=(online_ok == online_count and not errors),
                slots_released=(gate.active == 0 and not gate.waiting))
