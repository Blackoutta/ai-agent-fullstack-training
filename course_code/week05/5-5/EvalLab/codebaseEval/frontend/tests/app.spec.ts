import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { api } from '../src/api'
import { createWorkspace, pages } from '../src/workspace'
import { fixture } from './fixtures'
afterEach(() => { vi.restoreAllMocks(); location.hash = '' })

describe('完整工作台', () => {
  it('八个页面可导航并保持当前导航标记', async () => {
    vi.spyOn(api, 'state').mockResolvedValue(fixture())
    const wrapper = mount(App)
    await flushPromises()
    for (const page of pages) {
      location.hash = page.id
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await flushPromises()
      expect(wrapper.find('h1').text()).toBe(page.title)
      expect(wrapper.find('[aria-current="page"]').text()).toContain(page.title)
    }
    wrapper.unmount()
  })
  it('空状态不伪造成功率与模型成绩', async () => {
    const state = fixture()
    state.runs = []; state.tasks = []; state.strategies = []; state.experiments = []; state.clusters = []
    state.summary.runs = 0; state.summary.unknown = 0; state.summary.success_rate = null
    vi.spyOn(api, 'state').mockResolvedValue(state)
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.text()).toContain('还没有可统计的结果')
    expect(wrapper.text()).toContain('暂无')
    expect(wrapper.text()).not.toContain('100.0%')
    wrapper.unmount()
  })
  it('后端未启动显示连接错误而非模拟数据', async () => {
    vi.spyOn(api, 'state').mockRejectedValue(new Error('连接被拒绝'))
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('连接被拒绝')
    expect(wrapper.text()).toContain('评测服务尚未连接')
    wrapper.unmount()
  })
  it('健康轮询不抹掉操作错误', async () => {
    const workspace = createWorkspace()
    vi.spyOn(api, 'state').mockResolvedValue(fixture())
    await workspace.action(async () => { throw new Error('任务保存失败') })
    await workspace.refresh()
    expect(workspace.error.value).toBe('任务保存失败')
  })
  it('无效编码的运行链接可恢复而不崩溃', () => {
    const workspace = createWorkspace()
    location.hash = 'trace/%E0%A4%A'
    workspace.readHash()
    expect(workspace.page.value).toBe('trace')
    expect(workspace.runId.value).toBe('')
    expect(workspace.error.value).toContain('格式不正确')
  })
})
