<script setup lang="ts">
import { ref, toRaw } from 'vue'
import { Cpu, Plus, Settings2 } from 'lucide-vue-next'
import type { Strategy } from '../types'
import { api } from '../api'
import { useWorkspace } from '../workspace'
import EmptyState from '../components/EmptyState.vue'
import ModalPanel from '../components/ModalPanel.vue'
const { state, action, pending, error } = useWorkspace()
const editor = ref<Strategy | null>(null)
const deleting = ref<Strategy | null>(null)
function edit(strategy?: Strategy) {
  editor.value = strategy ? structuredClone(toRaw(strategy)) : {
    name: '', system_prompt: '', model: '', base_url: 'https://api.openai.com/v1',
    api_key_env: 'OPENAI_API_KEY', rag_mode: 'off', top_k: 5,
    input_price: null, output_price: null, cache_price: null,
  }
}
function setPrice(field: 'input_price' | 'output_price' | 'cache_price', event: Event) {
  if (!editor.value) return
  const value = (event.target as HTMLInputElement).value
  editor.value[field] = value === '' ? null : Number(value)
}
async function save() {
  if (editor.value && await action(() => api.saveStrategy(editor.value!), '策略已保存，既有实验快照不变')) editor.value = null
}
async function remove() {
  if (!deleting.value?.id) return
  const id = deleting.value.id
  if (await action(async () => { await api.deleteStrategy(id); return true }, '策略已删除')) deleting.value = null
}
</script>

<template>
  <div class="section-heading"><div><h2>策略库 <span class="count">{{ state!.strategies.length }}</span></h2><p class="subtle">每组配置都是独立、可追溯的实验条件</p></div>
    <button class="button primary" @click="edit()"><Plus :size="16" />新建策略</button></div>
  <section v-if="!state!.strategies.length" class="panel"><EmptyState title="配置第一个评测策略" description="选择模型、系统提示词与本机文档检索方式。"><button class="button primary" @click="edit()">创建策略</button></EmptyState></section>
  <div v-else class="strategy-grid">
    <article v-for="strategy in state!.strategies" :key="strategy.id" class="panel strategy-card">
      <div class="strategy-card-top"><span class="card-icon"><Cpu :size="22" /></span><span class="tag">{{ strategy.rag_mode === 'off' ? '无检索' : `${strategy.rag_mode.toUpperCase()} 检索` }}</span></div>
      <h2>{{ strategy.name }}</h2><p class="mono model-name">{{ strategy.model }}</p>
      <p class="prompt-preview">{{ strategy.system_prompt || '未设置系统提示词' }}</p>
      <dl class="config-list"><div><dt>模型基址</dt><dd class="truncate">{{ strategy.base_url }}</dd></div><div><dt>检索 Top-K</dt><dd>{{ strategy.rag_mode === 'off' ? '不启用' : strategy.top_k }}</dd></div><div><dt>输入 / 输出价格</dt><dd>{{ strategy.input_price ?? '未知' }} / {{ strategy.output_price ?? '未知' }}</dd></div><div><dt>凭据变量</dt><dd class="mono">{{ strategy.api_key_env }}</dd></div></dl>
      <footer class="card-footer"><button class="text-button" @click="edit(strategy)"><Settings2 :size="15" />编辑配置</button><button class="text-button danger" @click="deleting = strategy">删除</button></footer>
    </article>
  </div>
  <div class="note">价格单位为美元 / 百万 Token，留空代表未知，不按 0 估算。RAG 是本机文档检索，不是向量检索。凭据仅从服务端环境变量读取。</div>
  <ModalPanel v-if="editor" :title="editor.id ? '编辑策略' : '新建评测策略'" @close="!pending && (editor = null)">
    <form class="form-body" @submit.prevent="save">
      <label>策略名称<input v-model="editor.name" required maxlength="120" placeholder="例如：BM25 + 证据约束 Prompt" /></label>
      <label>系统 Prompt<textarea v-model="editor.system_prompt" rows="5" placeholder="定义角色、证据引用和输出约束" /></label>
      <div class="form-grid"><label>模型名称<input v-model="editor.model" required placeholder="模型标识" /></label><label>API 基址<input v-model="editor.base_url" required type="url" placeholder="https://.../v1" /></label></div>
      <label>凭据环境变量名<input v-model="editor.api_key_env" required pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder="OPENAI_API_KEY" /><small>只填写变量名，不填写 API Key。浏览器不存储密钥。</small></label>
      <div class="form-grid"><label>RAG 模式<select v-model="editor.rag_mode"><option value="off">关闭检索</option><option value="keyword">Keyword 关键词检索</option><option value="bm25">BM25 排序检索</option></select></label><label>Top-K<input v-model.number="editor.top_k" required type="number" min="1" max="50" step="1" :disabled="editor.rag_mode === 'off'" /></label></div>
      <h3>价格估算 <span class="subtle">USD / 1M Token</span></h3>
      <div class="form-grid prices"><label>输入价格<input :value="editor.input_price" type="number" min="0" step="any" placeholder="未知" @input="setPrice('input_price', $event)" /></label><label>输出价格<input :value="editor.output_price" type="number" min="0" step="any" placeholder="未知" @input="setPrice('output_price', $event)" /></label><label>缓存价格<input :value="editor.cache_price" type="number" min="0" step="any" placeholder="未知" @input="setPrice('cache_price', $event)" /></label></div>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <footer class="form-footer"><button type="button" class="button secondary" :disabled="pending" @click="editor = null">取消</button><button class="button primary" :disabled="pending">{{ pending ? '保存中…' : '保存策略' }}</button></footer>
    </form>
  </ModalPanel>
  <ModalPanel v-if="deleting" title="删除策略？" @close="!pending && (deleting = null)"><div class="form-body"><p>将删除「{{ deleting.name }}」。历史运行保留原始策略快照。</p><p v-if="error" class="inline-error">{{ error }}</p><footer class="form-footer"><button class="button secondary" :disabled="pending" @click="deleting = null">保留</button><button class="button destructive" :disabled="pending" @click="remove">确认删除</button></footer></div></ModalPanel>
</template>
