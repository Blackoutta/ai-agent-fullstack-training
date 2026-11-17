<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide } from 'vue'
import { Activity, ArrowUpRight, BookOpen, ChevronRight, FlaskConical, GitCompareArrows,
  LayoutDashboard, ListChecks, RefreshCw, ScanLine, Settings2, ShieldCheck } from 'lucide-vue-next'
import { createWorkspace, pages, workspaceKey } from './workspace'
import OverviewView from './views/OverviewView.vue'
import BenchmarkView from './views/BenchmarkView.vue'
import StrategiesView from './views/StrategiesView.vue'
import ExperimentsView from './views/ExperimentsView.vue'
import TraceView from './views/TraceView.vue'
import ReviewsView from './views/ReviewsView.vue'
import ClustersView from './views/ClustersView.vue'
import CompareView from './views/CompareView.vue'
const workspace = createWorkspace()
provide(workspaceKey, workspace)
const { page, state, loading, pending, error, notice, refreshedAt, navigate } = workspace
const current = computed(() => pages.find(item => item.id === page.value) ?? pages[0]!)
const icons = [LayoutDashboard, BookOpen, Settings2, FlaskConical, ScanLine, ListChecks, Activity, GitCompareArrows]
const views = { overview: OverviewView, benchmark: BenchmarkView, strategies: StrategiesView,
  experiments: ExperimentsView, trace: TraceView, reviews: ReviewsView, clusters: ClustersView, compare: CompareView }
let timer: ReturnType<typeof setInterval>
onMounted(() => {
  workspace.readHash()
  window.addEventListener('hashchange', workspace.readHash)
  void workspace.refresh()
  timer = setInterval(() => { if (!document.hidden && !pending.value) void workspace.refresh() }, 5000)
})
onUnmounted(() => { clearInterval(timer); window.removeEventListener('hashchange', workspace.readHash) })
</script>

<template>
  <a class="skip-link" href="#workspace-main">跳转到主要内容</a>
  <div class="app-layout">
    <aside class="sidebar">
      <a href="#overview" class="brand" aria-label="Codebase Eval 首页">
        <span class="brand-icon"><ScanLine :size="24" /></span>
        <span>Codebase<span class="brand-sub">EVAL WORKSPACE</span></span>
      </a>
      <div class="workspace-label"><span class="workspace-avatar">C</span><div>本地评测空间<small>Local workspace</small></div><ShieldCheck :size="15" /></div>
      <p class="nav-caption">工作台</p>
      <nav aria-label="主要导航">
        <a v-for="(item, index) in pages" :key="item.id" :href="`#${item.id}`"
          :class="{ active: page === item.id }" :aria-current="page === item.id ? 'page' : undefined">
          <component :is="icons[index]" :size="18" aria-hidden="true" />
          <span>{{ item.title }}</span><ChevronRight v-if="page === item.id" :size="14" />
        </a>
      </nav>
      <div class="sidebar-bottom">
        <div class="boundary"><ShieldCheck :size="18" /><strong>只读 · 保留审批</strong><p>仅运行可信本地源码。<br />不自动批准工具写入。</p></div>
        <div class="sidebar-footer"><span class="status-dot"></span>本地单体 <span class="mono">v1.0</span></div>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><div class="breadcrumb">工作台 <ChevronRight :size="14" /><strong>{{ current.title }}</strong></div>
        <div class="topbar-right"><span class="connection" :class="{ disconnected: !state || error }"><span class="status-dot"></span>{{ state ? '本地服务已连接' : '等待本地服务' }}</span><span class="user-avatar">本</span></div>
      </header>
      <main id="workspace-main" tabindex="-1">
        <div class="page-heading"><div><p class="eyebrow">CODEBASE EVALUATION</p><h1>{{ current.title }}</h1><p>{{ current.subtitle }}</p></div>
          <div class="heading-actions"><button class="button secondary" :disabled="loading" @click="workspace.refresh()"><RefreshCw :size="15" :class="{ spin: loading }" />刷新</button>
            <button v-if="page === 'overview'" class="button primary" @click="navigate('experiments')">启动实验 <ArrowUpRight :size="16" /></button></div>
        </div>
        <div class="safety-strip"><ShieldCheck :size="16" /><span>离线验证仅检查平台链路，不代表真实模型成绩；离线回归报告始终暂缓采用。</span><span class="local-tag">LOCAL ONLY</span></div>
        <div v-if="error" class="alert error" role="alert"><strong>操作或连接失败</strong><span>{{ error }}</span><button class="text-button" @click="workspace.refresh()">重试连接</button></div>
        <div v-if="notice" class="alert success" role="status">{{ notice }}<button class="text-button" @click="notice = ''">关闭</button></div>
        <div v-if="!state" class="panel loading-panel" role="status"><RefreshCw :size="24" :class="{ spin: loading }" /><h2>{{ loading ? '正在连接评测服务' : '评测服务尚未连接' }}</h2><p>请启动本地 Python API，再刷新工作台。不会展示模拟成绩。</p></div>
        <component :is="views[page]" v-else />
        <footer class="main-footer"><span>Codebase Eval / 可追溯 · 可比较 · 可复现</span><span aria-live="off">{{ refreshedAt ? `最后同步 ${refreshedAt}` : '尚未同步' }}</span></footer>
      </main>
    </div>
  </div>
</template>
