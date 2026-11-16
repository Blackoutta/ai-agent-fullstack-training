"""Single-event-loop bounded scheduler; cache lookup belongs before submit()."""
import asyncio
import time
from dataclasses import dataclass
from typing import Any, Callable

class QueueFull(Exception): pass
class QueueExpired(TimeoutError): pass

@dataclass(eq=False)
class Job:
    factory: Callable
    priority: int
    background: bool
    deadline: float
    entered: float
    future: Any
    timer: Any = None
    task: Any = None
    released: bool = False

class Scheduler:
    def __init__(self, concurrency=2, max_waiting=8, background_limit=1,
                 queue_timeout=2.0, request_timeout=12.0, aging_seconds=1.0):
        if concurrency < 1 or max_waiting < 1 or not 0 <= background_limit < concurrency:
            raise ValueError('reserve at least one online slot')
        self.concurrency, self.max_waiting = concurrency, max_waiting
        self.background_limit, self.queue_timeout = background_limit, queue_timeout
        self.request_timeout, self.aging_seconds = request_timeout, aging_seconds
        self.active = self.background = 0
        self.waiting, self.running, self.events = [], set(), []
        self.closed = False

    def event(self, kind, job):
        self.events.append(dict(event=kind, priority=job.priority, background=job.background,
                                active=self.active, at=time.monotonic(),
                                queue_ms=round((time.monotonic()-job.entered)*1000, 2)))

    def allowed(self, job):
        return self.active < self.concurrency and (not job.background or self.background < self.background_limit)

    async def submit(self, factory, *, priority=0, background=False, deadline=None):
        if self.closed: raise RuntimeError('scheduler closed')
        now = time.monotonic()
        deadline = deadline if deadline is not None else now + 30
        if deadline <= now: raise QueueExpired('task deadline')
        job = Job(factory, priority, background, deadline, now, asyncio.get_running_loop().create_future())
        self.drain()
        if len(self.waiting) >= self.max_waiting:
            # A full background queue must not consume the reserved online slot.
            if self.allowed(job): self.start(job)
            else: raise QueueFull('waiting queue full')
        else:
            self.waiting.append(job)
            job.timer = asyncio.get_running_loop().call_later(
                min(self.queue_timeout, deadline-now), self.expire, job)
            self.drain()
        try:
            return await job.future
        finally:
            if job.future.cancelled():
                if job in self.waiting: self.waiting.remove(job)
                if job.timer: job.timer.cancel()
                if job.task: job.task.cancel()
                self.drain()

    def expire(self, job):
        if job not in self.waiting: return
        self.waiting.remove(job)
        if not job.future.done(): job.future.set_exception(QueueExpired('queue wait expired'))
        self.event('queue_expired', job)
        self.drain()

    def drain(self):
        now = time.monotonic()
        for job in list(self.waiting):
            if job.future.done():
                self.waiting.remove(job)
                if job.timer: job.timer.cancel()
            elif job.deadline <= now: self.expire(job)
        while self.active < self.concurrency:
            eligible = [j for j in self.waiting if self.allowed(j)]
            if not eligible: break
            # Lower number first; waiting time gradually improves priority.
            job = min(eligible, key=lambda j: (j.priority-(now-j.entered)/self.aging_seconds, j.entered))
            self.waiting.remove(job)
            self.start(job)

    def start(self, job):
        if job.timer: job.timer.cancel()
        self.active += 1
        self.background += int(job.background)
        self.event('start', job)
        job.task = asyncio.create_task(self.run(job))
        self.running.add(job.task)
        def settled(task):
            self.running.discard(task)
            if task.cancelled() and not job.future.done(): job.future.cancel()
            self.release(job)
        job.task.add_done_callback(settled)

    async def run(self, job):
        try:
            remaining = min(self.request_timeout, job.deadline-time.monotonic())
            if remaining <= 0: raise TimeoutError('task deadline')
            result = await asyncio.wait_for(job.factory(), remaining)
            if not job.future.done(): job.future.set_result(result)
        except asyncio.CancelledError:
            if not job.future.done(): job.future.cancel()
        except Exception as error:
            if not job.future.done(): job.future.set_exception(error)
        finally:
            self.release(job)

    def release(self, job):
        if job.released: return
        job.released = True
        self.active -= 1
        self.background -= int(job.background)
        self.event('release', job)
        self.drain()

    async def close(self):
        self.closed = True
        for job in list(self.waiting):
            if job.timer: job.timer.cancel()
            job.future.cancel()
        self.waiting.clear()
        for task in list(self.running): task.cancel()
        await asyncio.gather(*list(self.running), return_exceptions=True)
