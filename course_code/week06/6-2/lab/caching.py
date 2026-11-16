"""Application-owned cache policies around LlamaIndex primitives.
No authorization decisions are cached here. Scope/intent must come from trusted
server state; source_loader must recheck CURRENT permissions on every read.
"""
import copy
import hashlib
import json
import math
import threading
import time
from dataclasses import dataclass, asdict
from typing import Any
from pydantic import PrivateAttr
from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.core.schema import NodeWithScore
from llama_index.core.storage.kvstore import SimpleKVStore

@dataclass(frozen=True)
class Scope:
    tenant: str
    access: str
    corpus: str
    policy: str
    def __post_init__(self):
        if not all(asdict(self).values()): raise ValueError('scope fields must not be empty')

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,allow_nan=False).encode()).hexdigest()

class TTLCache:
    """Bounded single-process cache using native SimpleKVStore. Not distributed."""
    def __init__(self,store=None,collection='rag-lab-v1',max_entries=1000):
        if max_entries < 1: raise ValueError('max_entries must be positive')
        self.store=store if store is not None else SimpleKVStore()
        self.collection,self.max_entries=collection,max_entries
        self.lock=threading.RLock()
        self.stats={}
    def key(self,layer,conditions): return layer+':'+digest(conditions)
    def _count(self,layer,outcome):
        key=layer+':'+outcome
        self.stats[key]=self.stats.get(key,0)+1
    def get(self,key):
        with self.lock:
            item=self.store.get(key,collection=self.collection)
            if item is not None and item['expires'] <= time.time():
                self.store.delete(key,collection=self.collection); item=None
            self._count(key.split(':',1)[0],'hit' if item is not None else 'miss')
            return copy.deepcopy(item['value']) if item is not None else None
    def put(self,key,value,ttl):
        if ttl <= 0: raise ValueError('ttl must be positive')
        with self.lock:
            rows=self.store.get_all(collection=self.collection)
            if key not in rows and len(rows)>=self.max_entries:
                earliest=min(rows,key=lambda k:rows[k]['expires'])
                self.store.delete(earliest,collection=self.collection)
            self.store.put(key,{'expires':time.time()+ttl,'value':copy.deepcopy(value)},collection=self.collection)
    def persist(self,path):
        with self.lock:self.store.persist(persist_path=str(path))

class CachedEmbedding(BaseEmbedding):
    """Disable native text-only cache; add revision, role and tenant/access scope.
Changing the corpus does not invalidate unchanged text vectors. Revision MUST
change for changed weights, dimensions, role prefixes or preprocessing.
"""
    _base: Any = PrivateAttr()
    _cache: Any = PrivateAttr()
    _scope: Any = PrivateAttr()
    _revision: str = PrivateAttr()
    def __init__(self,base,cache,scope,revision,**kwargs):
        if not revision: raise ValueError('embedding revision required')
        if base.embeddings_cache is not None: raise ValueError('disable underlying unscoped embedding cache')
        if kwargs.get('embeddings_cache') is not None: raise ValueError('use scoped wrapper cache')
        super().__init__(model_name=base.model_name,**kwargs)
        self._base,self._cache,self._scope,self._revision=base,cache,scope,revision
    def _key(self,text,role):
        return self._cache.key('embedding',dict(tenant=self._scope.tenant,access=self._scope.access,
            model=self._base.model_name,revision=self._revision,role=role,text=text))
    def _get_query_embedding(self,query):
        key=self._key(query,'query'); value=self._cache.get(key)
        if value is None:
            value=self._base.get_query_embedding(query)
            self._check(value);self._cache.put(key,value,86400)
        return value
    def _get_text_embedding(self,text):return self._get_text_embeddings([text])[0]
    def _get_text_embeddings(self,texts):
        values={};missing=[]
        for text in dict.fromkeys(texts):
            value=self._cache.get(self._key(text,'document'))
            if value is None:missing.append(text)
            else:values[text]=value
        if missing:
            vectors=self._base.get_text_embedding_batch(missing)
            if len(vectors)!=len(missing):raise ValueError('embedding count mismatch')
            for text,vector in zip(missing,vectors):
                self._check(vector);values[text]=vector
                self._cache.put(self._key(text,'document'),vector,86400)
        return [values[t] for t in texts]
    @staticmethod
    def _check(vector):
        if not vector or any(not math.isfinite(x) for x in vector):raise ValueError('bad embedding')
    async def _aget_query_embedding(self,query):
        import asyncio
        return await asyncio.to_thread(self._get_query_embedding,query)
    async def _aget_text_embedding(self,text):
        import asyncio
        return await asyncio.to_thread(self._get_text_embedding,text)
    async def _aget_text_embeddings(self,texts):
        import asyncio
        return await asyncio.to_thread(self._get_text_embeddings,texts)

def source_ref(node,scope):
    if node.metadata.get('tenant')!=scope.tenant:raise PermissionError('wrong tenant')
    version=node.metadata.get('version')
    if not version:raise ValueError('source version required')
    return {'id':node.node_id,'version':version}

def load_ref(ref,scope,source_loader):
    # This callback reauthorizes now; do not pass a cached grant from request input.
    node=source_loader(ref['id'],scope)
    current=source_ref(node,scope)
    if current!=ref:raise ValueError('source version changed; refresh request scope')
    return node

async def cached_retrieve(retriever,query,scope,cache,source_loader,filters,top_k,
                          retrieval_revision='hybrid-rerank-v1'):
    key=cache.key('rag',dict(scope=asdict(scope),query=query,filters=filters,top_k=top_k,
                             retrieval_revision=retrieval_revision))
    refs=cache.get(key)
    if refs is None:
        nodes=await retriever.aretrieve(query)
        refs=[]
        for hit in nodes[:top_k]:
            if hit.score is not None and not math.isfinite(hit.score):raise ValueError('bad score')
            refs.append(dict(source_ref(hit.node,scope),score=hit.score))
        # Check current authorization before publishing a cache value.
        for ref in refs:load_ref({k:ref[k] for k in ['id','version']},scope,source_loader)
        cache.put(key,refs,60)
    return [NodeWithScore(node=load_ref({k:r[k] for k in ['id','version']},scope,source_loader),score=r['score']) for r in refs]

def cached_read(source_id,scope,cache,authorize_ref,fetch_text,tool='read_clause',tool_version='v1'):
    # Always reauthorize and obtain the current immutable content version using
    # cheap metadata. Only the expensive full-content fetch may be skipped.
    ref=authorize_ref(source_id,scope)
    if ref.get('tenant')!=scope.tenant or ref.get('id')!=source_id:raise PermissionError('wrong source scope')
    if not ref.get('version'):raise ValueError('source version required')
    key=cache.key('tool',dict(scope=asdict(scope),tool=tool,tool_version=tool_version,ref=ref))
    value=cache.get(key)
    if value is None:
        text=fetch_text(source_id,ref['version'],scope)
        value={'source_id':source_id,'version':ref['version'],'text':text}
        cache.put(key,value,60)
    return value

class ApprovedFAQCache:
    """Explicitly reviewed single-turn FAQ only; no arbitrary conversation replay."""
    def __init__(self,allowed_intents=('template-location',),max_entries=100):
        self.entries=[];self.allowed=set(allowed_intents);self.max_entries=max_entries
    def approve(self,*,scope,intent,question,answer,vector,space_id,reviewer,source_loader,ttl=300):
        if not reviewer or intent not in self.allowed or ttl<=0:raise ValueError('reviewed allowed FAQ required')
        if not space_id:raise ValueError('embedding space revision required')
        if not self._citations(answer,scope,source_loader):raise ValueError('invalid literal citations')
        self._norm(vector)
        self.entries.append(dict(scope=asdict(scope),intent=intent,question=question,
            answer=copy.deepcopy(answer),vector=list(vector),space_id=space_id,
            reviewer=reviewer,expires=time.time()+ttl))
        self.entries=self.entries[-self.max_entries:]
    @staticmethod
    def _norm(vector):
        if not vector or any(not math.isfinite(x) for x in vector):raise ValueError('bad vector')
        norm=math.sqrt(sum(x*x for x in vector))
        if norm==0:raise ValueError('zero vector')
        return norm
    @staticmethod
    def _citations(answer,scope,loader):
        citations=answer.get('citations',[])
        if not citations:return False
        for c in citations:
            node=load_ref({'id':c['source_id'],'version':c['version']},scope,loader)
            if not isinstance(c.get('quote'),str) or not c['quote'].strip() or c['quote'] not in node.text:return False
        return True
    def lookup(self,*,scope,intent,vector,space_id,single_turn,source_loader,threshold=.95):
        if not 0<=threshold<=1:raise ValueError('threshold out of range')
        if not single_turn or intent not in self.allowed:return None
        norm=self._norm(vector)
        candidates=[]
        for e in self.entries:
            if e['scope']!=asdict(scope) or e['intent']!=intent or e['space_id']!=space_id or e['expires']<=time.time():continue
            if len(e['vector'])!=len(vector):continue
            sim=sum(x*y for x,y in zip(vector,e['vector']))/(norm*self._norm(e['vector']))
            candidates.append((sim,e))
        for sim,e in sorted(candidates,key=lambda row:row[0],reverse=True):
            if sim>=threshold and self._citations(e['answer'],scope,source_loader):return copy.deepcopy(e['answer'])
        return None


def scoped_ingestion_cache(root,scope,transform_revision):
    """Namespace native transformation cache independently from answer cache."""
    from pathlib import Path
    from llama_index.core.ingestion import IngestionCache
    if not transform_revision:raise ValueError('transform revision required')
    root=Path(root);root.mkdir(parents=True,exist_ok=True,mode=0o700)
    namespace=digest(dict(tenant=scope.tenant,access=scope.access,transform_revision=transform_revision))
    path=root/(namespace+'.json')
    cache=IngestionCache.from_persist_path(str(path)) if path.exists() else IngestionCache()
    return cache,path
