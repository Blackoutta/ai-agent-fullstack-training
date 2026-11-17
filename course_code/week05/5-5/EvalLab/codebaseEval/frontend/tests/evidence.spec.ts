import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api'
import { createWorkspace, pretty } from '../src/workspace'
import RunExplorer from '../src/components/RunExplorer.vue'
import TraceTimeline from '../src/components/TraceTimeline.vue'
import ReviewPanel from '../src/components/ReviewPanel.vue'
import ModalPanel from '../src/components/ModalPanel.vue'
import StatusBadge from '../src/components/StatusBadge.vue'
import { fixture, run, setup } from './fixtures'
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('证据和评审核心组件', () => {
  it('模型答案只转义为文本，不执行 HTML', async () => {
    const ctx = setup()
    ctx.workspace.runId.value = 'r1'
    vi.spyOn(api, 'run').mockResolvedValue(run)
    const wrapper = mount(RunExplorer, { global: ctx.global })
    await flushPromises()
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('未知')
    wrapper.unmount()
  })
  it('递归过滤思维链和敏感字段，保留证据', () => {
    const text = pretty({ messages: [{ role: 'assistant', content: '引用 README', reasoning_content: '隐藏内容' }], api_key: '隐藏密钥' })
    expect(text).toContain('引用 README')
    expect(text).not.toContain('隐藏内容')
    expect(text).not.toContain('隐藏密钥')
  })
  it('时间轴切换到治理审计，空召回不伪造', async () => {
    const wrapper = mount(TraceTimeline, { props: { run: { ...run, trace: [{ type: 'tool_call', tool: 'read' }], audit: [{ type: 'approval', status: 'denied' }] } } })
    expect(wrapper.text()).toContain('tool_call')
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    ;(wrapper.find('details').element as HTMLDetailsElement).open = true
    await wrapper.find('details').trigger('toggle')
    expect(wrapper.text()).toContain('denied')
    await wrapper.findAll('[role="tab"]')[2]!.trigger('click')
    expect(wrapper.text()).toContain('没有记录此类事件')
    wrapper.unmount()
  })
  it('全部 pi.message_update 汇总计数，按需加载原始记录', async () => {
    const trace = [
      { event_type: 'pi.message_update', payload: { delta: 'first' } },
      { event_type: 'pi.message_update', payload: { delta: 'second' } },
      { event_type: 'pi.message_end' },
      { event_type: 'pi.message_update', payload: { delta: 'third' } },
    ]
    const wrapper = mount(TraceTimeline, { props: { run: { ...run, trace, audit: trace } } })
    expect(wrapper.findAll('.timeline > li')).toHaveLength(2)
    expect(wrapper.text()).toContain('合并 3 次')
    expect(wrapper.text()).toContain('查看 3 条原始事件')
    expect(wrapper.find('details').attributes('open')).toBeUndefined()
    expect(wrapper.find('pre').exists()).toBe(false)
    ;(wrapper.find('details').element as HTMLDetailsElement).open = true
    await wrapper.find('details').trigger('toggle')
    expect(wrapper.find('pre').text()).toContain('first')
    expect(wrapper.find('pre').text()).toContain('second')
    expect(wrapper.find('pre').text()).toContain('third')
    expect(trace).toHaveLength(4)
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    expect(wrapper.findAll('.timeline > li')).toHaveLength(4)
    wrapper.unmount()
  })
  it('汇总显示历史 message 正文，空消息说明不伪造正文', () => {
    const trace = [
      { type: 'message', text: '我先读取 sandbox.ts。' },
      { type: 'message', text: '' },
      { type: 'message_update', event_type: 'pi.message_update', payload: { type: 'message_update' } },
      { event_type: 'pi.message_end' },
      { event_type: 'pi.message_update' },
    ]
    const wrapper = mount(TraceTimeline, { props: { run: { ...run, trace } } })
    const summary = wrapper.find('.timeline > li')
    expect(summary.text()).toContain('合并 2 次')
    expect(summary.text()).toContain('我先读取 sandbox.ts。')
    expect(summary.text()).toContain('本条消息无文本正文')
    expect(summary.text()).toContain('message 2')
    expect(summary.find('details pre').exists()).toBe(false)
    wrapper.unmount()
  })
  it('实时追加 message_update 更新合并次数', async () => {
    const update = { type: 'pi.message_update' }
    const wrapper = mount(TraceTimeline, { props: { run: { ...run, trace: [update, update] } } })
    await wrapper.setProps({ run: { ...run, trace: [update, update, update] } })
    expect(wrapper.findAll('.timeline > li')).toHaveLength(1)
    expect(wrapper.text()).toContain('合并 3 次')
    wrapper.unmount()
  })
  it('按轮次展示模型消息和工具调用，审计归入对应调用', async () => {
    const trace = [
      { type: 'message', text: '第一轮读取权限。' },
      { type: 'message', text: '第二轮结论。' },
      { event_type: 'pi.turn_start' },
      { event_type: 'pi.message_update' },
      { event_type: 'pi.message_end', payload: { role: 'assistant' } },
      { event_type: 'pi.tool_execution_start', payload: { tool_call_id: 'call1', tool_name: 'read_file' } },
      { event_type: 'pi.tool_execution_end', payload: { tool_call_id: 'call1', tool_name: 'read_file', is_error: true } },
      { event_type: 'pi.turn_end' },
      { event_type: 'pi.turn_start' },
      { event_type: 'pi.message_end', payload: { role: 'assistant' } },
      { event_type: 'pi.turn_end' },
    ]
    const wrapper = mount(TraceTimeline, { props: { run: { ...run, trace,
      audit: [{ tool_call_id: 'call1', status: 'error', code: 'DENIED' }] } } })
    const turns = wrapper.findAll('.trace-turn')
    expect(turns).toHaveLength(2)
    expect(turns[0]!.text()).toContain('第一轮读取权限。')
    expect(turns[0]!.text()).not.toContain('第二轮结论。')
    expect(turns[1]!.text()).toContain('第二轮结论。')
    expect(turns[0]!.find('.trace-tool').text()).toContain('执行失败')
    expect(turns[0]!.find('.trace-tool').text()).toContain('3 条')
    expect(wrapper.find('.timeline').exists()).toBe(false)
    await wrapper.find('.trace-events-toggle').trigger('click')
    expect(wrapper.find('.timeline').exists()).toBe(true)
    expect(wrapper.text()).toContain('合并 1 次')
    wrapper.unmount()
  })
  it('未结束轮次和缺失消息不能误报完成或错误分配正文', () => {
    const trace = [
      { type: 'message', text: '归属不确定的正文' },
      { event_type: 'pi.turn_start' },
      { event_type: 'pi.tool_execution_start', payload: { tool_call_id: 'pending', tool_name: 'read_file' } },
    ]
    const wrapper = mount(TraceTimeline, { props: { run: { ...run, trace } } })
    expect(wrapper.text()).toContain('未记录轮次结束')
    expect(wrapper.find('.trace-tool').text()).toContain('未记录完成')
    expect(wrapper.find('.trace-turn').text()).not.toContain('归属不确定的正文')
    expect(wrapper.text()).toContain('消息记录尚未完整对齐')
    wrapper.unmount()
  })
  it('离线 Judge 按钮禁用，人工评审不会覆盖程序失败', async () => {
    const ctx = setup()
    vi.spyOn(api, 'state').mockResolvedValue(ctx.workspace.state.value!)
    const judge = vi.spyOn(api, 'judge')
    const review = vi.spyOn(api, 'review').mockResolvedValue({ ...run, outcome: 'fail' })
    const wrapper = mount(ReviewPanel, { props: { run: { ...run, checks: [{ id: 'c1', passed: false }] }, offline: true }, global: ctx.global })
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('人工通过不能覆盖')
    await wrapper.find('input').setValue('张三')
    await wrapper.find('select').setValue('pass')
    await wrapper.find('textarea').setValue('语义完整但检查未通过')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(judge).not.toHaveBeenCalled()
    expect(review).toHaveBeenCalledWith('r1', { reviewer: '张三', status: 'pass', reason: '语义完整但检查未通过' })
    expect(wrapper.emitted('updated')?.[0]?.[0]).toEqual(expect.objectContaining({ outcome: 'fail' }))
    wrapper.unmount()
  })
  it('API 失败在评审表单内可见，不清空输入', async () => {
    const ctx = setup()
    vi.spyOn(api, 'review').mockRejectedValue(new Error('评审保存失败'))
    const wrapper = mount(ReviewPanel, { props: { run, offline: false }, global: ctx.global })
    await wrapper.find('input').setValue('评审员')
    await wrapper.find('textarea').setValue('理由')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('评审保存失败')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('理由')
    wrapper.unmount()
  })
  it('弹窗带可访问名称，支持 Escape 和恢复焦点', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const wrapper = mount(ModalPanel, { props: { title: '编辑任务' }, attachTo: document.body, global: { stubs: { Teleport: true } } })
    expect(wrapper.find('[role="dialog"]').attributes('aria-modal')).toBe('true')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    expect(document.activeElement).toBe(opener)
  })
  it('未知状态可见，失败与通过不用单独颜色表达', () => {
    const wrapper = mount(StatusBadge, { props: { value: 'unknown' } })
    expect(wrapper.text()).toBe('待判定')
    wrapper.unmount()
  })
})

describe('共享刷新状态', () => {
  it('失败刷新保留旧数据和可见错误', async () => {
    const workspace = createWorkspace()
    workspace.state.value = fixture()
    vi.spyOn(api, 'state').mockRejectedValue(new Error('服务离线'))
    await workspace.refresh()
    expect(workspace.state.value?.tasks).toHaveLength(1)
    expect(workspace.error.value).toBe('服务离线')
  })
  it('防止重复提交，正确解除 pending', async () => {
    const workspace = createWorkspace()
    vi.spyOn(api, 'state').mockResolvedValue(fixture())
    const operation = vi.fn().mockResolvedValue('done')
    await Promise.all([workspace.action(operation), workspace.action(operation)])
    expect(operation).toHaveBeenCalledTimes(1)
    expect(workspace.pending.value).toBe(false)
  })
})
