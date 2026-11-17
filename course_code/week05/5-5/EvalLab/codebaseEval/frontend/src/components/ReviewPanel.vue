<script setup lang="ts">
import { computed, ref } from 'vue'
import { Gavel, ShieldCheck, UserRound } from 'lucide-vue-next'
import { api } from '../api'
import type { Review, Run } from '../types'
import { date, pretty, useWorkspace } from '../workspace'
import StatusBadge from './StatusBadge.vue'
const props = defineProps<{ run: Run; offline: boolean }>()
const emit = defineEmits<{ updated: [run: Run] }>()
const { action, pending, error } = useWorkspace()
const form = ref<Review>({ reviewer: '', status: 'unknown', reason: '' })
const blocked = computed(() => ['error', 'failed', 'timeout', 'cancelled'].includes(props.run.execution_status)
  || props.run.checks?.some(check => check.passed === false || check.status === 'fail'))
async function judge() {
  if (props.offline) return
  const run = await action(() => api.judge(props.run.id), 'Judge 已完成；费用记录由后端单独核算')
  if (run) emit('updated', run)
}
async function submit() {
  const snapshot = { ...form.value }
  const run = await action(() => api.review(props.run.id, snapshot), '人工评审已记录，历史评分不可变')
  if (run) { emit('updated', run); form.value.reason = '' }
}
</script>

<template>
  <div class="review-grid">
    <section>
      <div class="section-heading"><h3><ShieldCheck :size="17" />程序检查</h3><span class="subtle">{{ run.checks?.length ?? 0 }} 项</span></div>
      <div v-if="!run.checks?.length" class="note">未记录程序检查，不据此推断通过。</div>
      <div v-for="(check, index) in run.checks" :key="index" class="check-result"><div class="section-heading"><strong>{{ check.id ?? check.type ?? `检查 ${index + 1}` }}</strong><StatusBadge :value="check.passed === true ? 'pass' : check.passed === false ? 'fail' : String(check.status ?? 'unknown')" /></div><pre class="evidence">{{ pretty(check) }}</pre></div>
      <div class="judge-header section-heading"><h3><Gavel :size="17" />独立 LLM Judge</h3><button class="button secondary" :disabled="offline || pending" @click="judge">{{ pending ? '处理中…' : '执行 Judge' }}</button></div>
      <p v-if="offline" class="note">离线验证不能执行真实 Judge，也不能作为发布成绩。</p>
      <pre v-if="run.judge" class="evidence">{{ pretty(run.judge) }}</pre><div v-else class="note">Judge 尚未执行或无可用结果。程序通过不代表整体通过。</div>
    </section>
    <section class="human-review">
      <h3><UserRound :size="17" />人工语义评审</h3>
      <p class="subtle">保留评审者、理由与历史；Judge 分歧不被覆盖。</p>
      <div v-if="blocked" class="alert warning">本次运行有执行错误或程序失败。人工通过不能覆盖这类失败。</div>
      <form class="review-form" @submit.prevent="submit">
        <label>评审者<input v-model="form.reviewer" required maxlength="100" placeholder="姓名或标识" /></label>
        <label>语义判断<select v-model="form.status"><option value="unknown">未知 / 证据不足</option><option value="pass">通过</option><option value="fail">失败</option></select></label>
        <label>判断理由<textarea v-model="form.reason" required rows="4" placeholder="引用答案和执行证据，说明判断依据" /></label>
        <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
        <button class="button primary" :disabled="pending">提交人工评审</button>
      </form>
      <h3 class="history-title">不可变评审历史 <span class="count">{{ run.reviews?.length ?? 0 }}</span></h3>
      <p v-if="!run.reviews?.length" class="subtle">还没有人工评审记录。</p>
      <article v-for="(review, index) in [...(run.reviews ?? [])].reverse()" :key="review.id ?? index" class="review-history">
        <div class="section-heading"><strong>{{ review.reviewer }}</strong><StatusBadge :value="review.status" /></div><p class="plain-text">{{ review.reason }}</p><small v-if="review.created_at">{{ date(review.created_at) }}</small>
      </article>
    </section>
  </div>
</template>
