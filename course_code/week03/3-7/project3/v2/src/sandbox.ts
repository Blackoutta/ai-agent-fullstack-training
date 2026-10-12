import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, matchesGlob, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { ToolRuntimeError } from "./domain.js";

export interface SandboxConfig {
  root: string;
  denyRead: string[];
  denyWrite: string[];
  /** 允许例外：命中 deny_write 但落在这份名单里的路径放行。默认空，与只写 deny_write 时行为一致。 */
  allowWrite?: string[];
  /** 单次文件读取进入结果的上限，单位是字符。 */
  maxReadChars: number;
  /** 单次命令输出进入结果的上限，单位是字符。 */
  maxOutputChars: number;
  /** 子进程输出的采集兜底，单位是字节，只为防住一条把内存打满的命令。 */
  maxCaptureBytes: number;
  commandTimeoutMs: number;
  killGraceMs: number;
  secretEnvPattern: string;
}

export interface Violation {
  code: string;
  reason: string;
}

export interface ExecOptions {
  argv: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ExecResult {
  exit_code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timed_out: boolean;
  duration_ms: number;
}

/**
 * 仓库工具的边界。四类判定在同一个入口做完：路径是否落在工作区内、是否命中禁止读取清单、
 * 写操作是否命中禁止写入清单、以及是否落在允许例外名单里（deny_write 是整片封死，
 * allow_write 在其上开一个受控口子，例如只放行新增测试的目录）。
 * 符号链接用最近已存在祖先的 realpath 展开后再判定。
 */
export class Sandbox {
  readonly root: string;

  constructor(private readonly config: SandboxConfig) {
    // root 自己也要展开：macOS 的 /var 是指向 /private/var 的符号链接，
    // 候选路径走 realpath 而 root 不走，会让工作区内的每个路径都被判成越界。
    const resolved = resolve(config.root);
    this.root = existsSync(resolved) ? realpathSync.native(resolved) : resolved;
  }

  get rules(): SandboxConfig {
    return this.config;
  }

  absolute(input: string): string {
    return isAbsolute(input) ? resolve(input) : resolve(this.root, input);
  }

  canonical(absolutePath: string): string {
    let cursor = absolutePath;
    const tail: string[] = [];
    for (;;) {
      try {
        return resolve(realpathSync.native(cursor), ...tail);
      } catch {
        const parent = dirname(cursor);
        if (parent === cursor) return absolutePath;
        tail.unshift(basename(cursor));
        cursor = parent;
      }
    }
  }

  isInside(candidate: string): boolean {
    const diff = relative(this.root, candidate);
    return diff === "" || (!diff.startsWith(`..${sep}`) && diff !== ".." && !isAbsolute(diff));
  }

  relativeOf(absolutePath: string): string {
    return relative(this.root, absolutePath).split(sep).join("/");
  }

  inspect(input: string, options: { write?: boolean } = {}): Violation | undefined {
    const absolutePath = this.absolute(input);
    const real = this.canonical(absolutePath);
    if (!this.isInside(real)) {
      return { code: "PATH_OUT_OF_WORKSPACE", reason: `路径 ${input} 解析到工作区 ${this.root} 之外` };
    }
    const rel = this.relativeOf(real) || ".";
    if (matchesAny(rel, this.config.denyRead)) {
      return { code: "PATH_DENY_READ", reason: `${rel} 在 deny_read 名单中` };
    }
    if (options.write && matchesAny(rel, this.config.denyWrite)) {
      // 允许例外优先：命中禁写但在 allow_write 名单内则放行，让“新增测试”这类受控写入成为可能。
      if (!matchesAny(rel, this.config.allowWrite ?? [])) {
        return { code: "PATH_DENY_WRITE", reason: `${rel} 在 deny_write 名单中` };
      }
    }
    return undefined;
  }

  check(input: string, options: { write?: boolean } = {}): string {
    const violation = this.inspect(input, options);
    if (violation) throw new ToolRuntimeError(violation.code, violation.reason);
    return this.absolute(input);
  }

  commandEnv(): NodeJS.ProcessEnv {
    const pattern = new RegExp(this.config.secretEnvPattern, "i");
    return Object.fromEntries(Object.entries(process.env).filter(([key]) => !pattern.test(key)));
  }

  async exec(options: ExecOptions): Promise<ExecResult> {
    const timeoutMs = options.timeoutMs ?? this.config.commandTimeoutMs;
    const maxCaptureBytes = this.config.maxCaptureBytes;
    const startedAt = Date.now();
    const detached = process.platform !== "win32";

    return await new Promise<ExecResult>((resolvePromise, rejectPromise) => {
      const [command, ...args] = options.argv;
      const child = spawn(command, args, {
        cwd: this.root,
        env: this.commandEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        detached,
      });

      let stdout = "";
      let stderr = "";
      let outBytes = 0;
      let truncated = false;
      let timedOut = false;
      let killTimer: NodeJS.Timeout | undefined;

      const kill = (signal: NodeJS.Signals) => {
        try {
          if (detached && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          // 进程已经退出，无需处理
        }
      };

      const accumulate = (chunk: Buffer, target: "stdout" | "stderr") => {
        outBytes += chunk.length;
        if (outBytes > maxCaptureBytes) {
          truncated = true;
          return;
        }
        if (target === "stdout") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };

      child.stdout.on("data", (chunk: Buffer) => accumulate(chunk, "stdout"));
      child.stderr.on("data", (chunk: Buffer) => accumulate(chunk, "stderr"));

      const timer = setTimeout(() => {
        timedOut = true;
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), this.config.killGraceMs);
      }, timeoutMs);

      const abortListener = () => {
        timedOut = true;
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), this.config.killGraceMs);
      };
      options.signal?.addEventListener("abort", abortListener, { once: true });

      child.once("error", (error) => {
        cleanup();
        rejectPromise(error);
      });

      child.once("close", (exitCode, signal) => {
        cleanup();
        resolvePromise({
          exit_code: exitCode,
          signal,
          stdout: truncated ? `${stdout}\n[子进程输出超过 ${maxCaptureBytes} 字节采集上限，后续已丢弃]` : stdout,
          stderr,
          truncated,
          timed_out: timedOut,
          duration_ms: Date.now() - startedAt,
        });
      });

      function cleanup(): void {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", abortListener);
      }
    });
  }
}

function matchesAny(relPath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(relPath, pattern));
}
