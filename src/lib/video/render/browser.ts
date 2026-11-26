import { type ChildProcess, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// A minimal Chrome DevTools Protocol driver for a headless Chromium browser,
// adapted from the product-video skill's toolkit (.claude/skills/product-video,
// assets/toolkit/browser.ts). No dependencies: it needs Node 22+ (fetch,
// WebSocket). Changes from the toolkit: the browser picks its own debugging
// port, so renders side by side never share one; pages are set from HTML
// rather than opened by URL; a command that never answers fails.

export const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)))

/** The browser to start and any flags its build needs (serverless builds do). */
export interface BrowserBinary {
  executable: string
  args: string[]
}

export type Viewport = { width: number; height: number }

type Handler = (params: any) => void
type Pending = {
  method: string
  resolve: (result: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Longest any one DevTools command may take before the render is given up. */
const COMMAND_TIMEOUT_MS = 30_000
/** Longest the browser may take to open its debugging port. */
const LAUNCH_TIMEOUT_MS = 30_000

export class Browser {
  #ws: WebSocket
  #proc: ChildProcess
  #seq = 0
  #pending = new Map<number, Pending>()
  #handlers = new Map<string, Handler[]>()
  #closed = false

  constructor(proc: ChildProcess, ws: WebSocket) {
    this.#proc = proc
    this.#ws = ws
    ws.addEventListener('message', event => {
      const msg = JSON.parse(String(event.data))
      if (msg.id) {
        const pending = this.#pending.get(msg.id)
        this.#pending.delete(msg.id)
        if (pending) clearTimeout(pending.timer)
        if (msg.error) pending?.reject(new Error(msg.error.message))
        else pending?.resolve(msg.result)
      } else if (msg.method) {
        for (const handler of this.#handlers.get(msg.method) ?? [])
          handler(msg.params)
      }
    })
    // A crashed or closed browser fails every waiting command instead of hanging
    ws.addEventListener('close', () => {
      this.#closed = true
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(this.#closedError(pending.method))
      }
      this.#pending.clear()
    })
  }

  #closedError(method: string) {
    return new Error(
      `The browser closed before ${method} finished, so recording stopped.`
    )
  }

  /**
   * Starts a headless browser that lays pages out at `viewport` CSS pixels
   * and renders them at `pixelRatio`, then attaches to its tab.
   */
  static async launch({
    binary,
    viewport,
    pixelRatio,
    profileDir
  }: {
    binary: BrowserBinary
    viewport: Viewport
    pixelRatio: number
    profileDir: string
  }) {
    if (typeof WebSocket === 'undefined') {
      throw new Error('Recording a video needs Node.js 22 or later.')
    }
    const headless = binary.args.some(arg => arg.startsWith('--headless'))
      ? []
      : ['--headless=new']
    const proc = spawn(
      binary.executable,
      [
        ...binary.args,
        ...headless,
        // Port 0: the browser picks a free port and names it in
        // DevToolsActivePort, so renders side by side never meet on one port
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        `--window-size=${viewport.width},${viewport.height}`,
        // Without this, screencast frames arrive at 1x even with emulation
        `--force-device-scale-factor=${pixelRatio}`,
        '--hide-scrollbars',
        '--font-render-hinting=none',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    // The end of what the browser printed, to explain a failed start
    let log = ''
    proc.stderr?.on('data', chunk => {
      log = (log + String(chunk)).slice(-2000)
    })
    let exited: string | null = null
    proc.once('error', err => {
      exited = err.message
    })
    proc.once('exit', code => {
      exited ??= `exit code ${code}`
    })

    let url: string | undefined
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS
    while (!url && !exited && Date.now() < deadline) {
      try {
        const [port] = (
          await readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8')
        ).split('\n')
        const response = await fetch(`http://127.0.0.1:${port}/json/list`)
        const targets = (await response.json()) as Array<{
          type: string
          webSocketDebuggerUrl: string
        }>
        url = targets.find(t => t.type === 'page')?.webSocketDebuggerUrl
      } catch {
        // The browser is still starting
      }
      if (!url) await sleep(100)
    }
    if (!url) {
      proc.kill('SIGKILL')
      const why = exited ? `It stopped (${exited}).` : 'It did not answer.'
      throw new Error(
        `The browser could not be started to record the video. ${why} ${log.trim().split('\n').slice(-3).join(' ')}`.trim()
      )
    }

    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    const browser = new Browser(proc, ws)
    await browser.send('Page.enable')
    await browser.send('Runtime.enable')
    await browser.send('Emulation.setDeviceMetricsOverride', {
      ...viewport,
      deviceScaleFactor: pixelRatio,
      mobile: false
    })
    return browser
  }

  /** Sends a raw DevTools Protocol command and resolves with its result. */
  send<T = any>(method: string, params: object = {}): Promise<T> {
    if (this.#closed) return Promise.reject(this.#closedError(method))
    const id = ++this.#seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`The browser did not answer ${method} in time.`))
      }, COMMAND_TIMEOUT_MS)
      this.#pending.set(id, { method, resolve, reject, timer })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(event: string, handler: Handler) {
    this.#handlers.set(event, [...(this.#handlers.get(event) ?? []), handler])
  }

  off(event: string) {
    this.#handlers.delete(event)
  }

  /** Runs a JavaScript expression in the page and returns its value. */
  async eval<T = any>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text
      )
    return r.result.value
  }

  /**
   * Replaces the tab's page with `html`, then waits until its fonts are
   * ready and it has settled. Nothing is fetched: the page carries its fonts
   * and images.
   */
  async setContent(html: string, { settleMs = 300 } = {}) {
    const { frameTree } = await this.send('Page.getFrameTree')
    await this.send('Page.setDocumentContent', {
      frameId: frameTree.frame.id,
      html
    })
    await this.eval('document.fonts.ready.then(() => true)').catch(() => {})
    await sleep(settleMs)
  }

  async close() {
    await this.send('Browser.close').catch(() => {})
    this.#ws.close()
    if (this.#proc.exitCode === null) {
      const exited = new Promise(resolve => this.#proc.once('exit', resolve))
      this.#proc.kill('SIGKILL')
      await Promise.race([exited, sleep(2000)])
    }
  }
}
