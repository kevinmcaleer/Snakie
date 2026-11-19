/*!
 * snakie-embed.js — drop Snakie code embeds into any page (snakie#1288).
 *
 *   <div data-snakie-gist="87a7e27a3273c30a413b2195927296fe" data-file="main.py" data-view="split">
 *     <a href="https://gist.github.com/87a7e27a3273c30a413b2195927296fe">See the code on GitHub</a>
 *   </div>
 *   <div data-snakie-repo="kevinmcaleer/burgerbot" data-path="main.py"></div>
 *   <script src="https://app.snakie.org/snakie-embed.js" defer></script>
 *
 * Each element becomes an iframe of /embed.html. Every other data-* attribute
 * (file, path, ref, lines, view, views, toolbox, run, autorun, theme, height, engine,
 * packages, board, pins, code, name) is passed through as a URL parameter.
 *
 * Size: data-width="full|wide|medium|narrow|<px>|<n>%" (default full; a
 * narrower box sits at the left) and data-height="auto|short|medium|tall|<px>"
 * (default auto: the box grows to fit the code). The iframe is
 * created when the element nears the viewport, and its height follows the
 * embed's content (postMessage, origin-checked). Without JavaScript the
 * element's own content (a GitHub link) stays visible.
 *
 * For content added later: SnakieEmbed.mount(el, { gist, file, … }) returns
 * { iframe, unmount() }. SnakieEmbed.scan(root) mounts any new data-snakie-*
 * elements under root. SnakieEmbed.upgrade(preEl, { name, board }) turns a
 * plain code block into a live box in place and runs it ("Run here"); its
 * unmount() puts the block back.
 *
 * Frames on one page share what they point at (#1320): hover a pin in one and
 * the others light it. The page can join in: document gets `snakie:pin-hover`
 * ({ pins, id }), `snakie:pin-state` ({ states: { GP15: { kind, value } } })
 * and `snakie:pins` (what a frame's code uses, and where a project's wiring
 * disagrees) events, and SnakieEmbed.hover(['GP15']) lights a pin in every
 * frame. data-project="<kevsrobots project id>" names the parts on each pin;
 * data-paths="main.py,servo.py" shows several files of a repo as tabs.
 *
 * A robot frame (#1321): <div data-snakie-robot="<kevsrobots project id>">
 * draws the project's URDF, and Run in a code frame on the same page turns
 * the joints the project's wiring binds to servo pins.
 * No dependencies; MIT.
 */
;(function () {
  'use strict'
  if (window.SnakieEmbed && window.SnakieEmbed.version) return

  var script = document.currentScript
  var ORIGIN = (function () {
    try {
      return new URL(script && script.src ? script.src : 'https://app.snakie.org/').origin
    } catch (e) {
      return 'https://app.snakie.org'
    }
  })()
  var PARAMS = [
    'gist', 'user', 'file', 'revision', 'repo', 'path', 'ref', 'lines', 'code', 'name',
    'view', 'views', 'toolbox', 'run', 'autorun', 'theme', 'height', 'engine', 'packages',
    'board', 'pins', 'project', 'paths', 'robot', 'urdf'
  ]
  var DEFAULT_HEIGHT = 360
  var RADIUS = 12
  // Named sizes, so a page can say "narrow" or "short" without picking pixels.
  var WIDTHS = { full: '100%', wide: '860px', medium: '680px', narrow: '520px' }
  var HEIGHTS = { short: 320, medium: 460, tall: 640 }

  // '680px' / '60%' / null (full width) for a width option.
  function widthFor(v) {
    if (v === undefined || v === null || v === '') return null
    v = String(v).trim().toLowerCase()
    if (WIDTHS[v]) return v === 'full' ? null : WIDTHS[v]
    var m = /^(\d+(?:\.\d+)?)(px|%)?$/.exec(v)
    if (!m) return null
    var n = Number(m[1])
    if (m[2] === '%') return n >= 100 ? null : Math.max(20, n) + '%'
    return Math.max(240, Math.round(n)) + 'px'
  }

  // A fixed height in px, or null for auto (follow the content).
  function heightFor(v) {
    if (v === undefined || v === null || v === '') return null
    v = String(v).trim().toLowerCase()
    if (HEIGHTS[v]) return HEIGHTS[v]
    var m = /^(\d+)(px)?$/.exec(v)
    return m ? Math.max(160, Math.min(2000, Number(m[1]))) : null
  }
  var counter = 0
  var frames = {}

  function optionsFromElement(el) {
    var opts = {}
    var d = el.dataset
    if (d.snakieGist) opts.gist = d.snakieGist
    if (d.snakieRepo) opts.repo = d.snakieRepo
    if (d.snakieCode) opts.code = d.snakieCode
    // A robot frame (#1321): data-snakie-robot="<kevsrobots project id>", or
    // an https address of a URDF.
    if (d.snakieRobot) {
      opts.robot = '1'
      if (/^\d+$/.test(d.snakieRobot)) opts.project = d.snakieRobot
      else opts.urdf = d.snakieRobot
    }
    for (var i = 0; i < PARAMS.length; i++) {
      var key = PARAMS[i]
      if (d[key] !== undefined && opts[key] === undefined) opts[key] = d[key]
    }
    if (d.title) opts.title = d.title
    if (d.width) opts.width = d.width
    return opts
  }

  function embedUrl(opts, id) {
    var q = []
    for (var i = 0; i < PARAMS.length; i++) {
      var key = PARAMS[i]
      var v = key === 'height' ? heightFor(opts.height) : opts[key]
      if (v === undefined || v === null || v === '') continue
      if (v === true) v = '1'
      if (v === false) v = '0'
      q.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)))
    }
    q.push('id=' + encodeURIComponent(id))
    return ORIGIN + '/embed.html?' + q.join('&')
  }

  function mount(el, opts) {
    opts = opts || optionsFromElement(el)
    if (el.__snakieEmbed) el.__snakieEmbed.unmount()
    var id = 'snakie-' + ++counter
    var iframe = document.createElement('iframe')
    iframe.src = embedUrl(opts, id)
    iframe.title = opts.title || (opts.robot ? 'Robot' : opts.file || opts.path || opts.name || 'Code') + ' in Snakie'
    iframe.loading = 'lazy'
    iframe.setAttribute('allow', 'clipboard-write')
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    var fixed = heightFor(opts.height)
    iframe.style.cssText =
      'display:block;width:100%;max-width:100%;border:0;margin:0;background:transparent;color-scheme:normal;' +
      'height:' + (fixed || DEFAULT_HEIGHT) + 'px;transition:height .15s ease'
    iframe.style.setProperty('border-radius', RADIUS + 'px', 'important')
    el.classList.add('snakie-embed')
    // The box clips the frame to its rounded corners itself, so a page rule on
    // iframes (border-radius: 0, say) can't uncover the embed's own corners.
    var width = widthFor(opts.width)
    el.style.borderRadius = RADIUS + 'px'
    el.style.overflow = 'hidden'
    el.style.maxWidth = width || ''
    // Keep the fallback (a GitHub link) for screen readers until the frame loads.
    var fallback = Array.prototype.slice.call(el.childNodes)
    iframe.addEventListener('load', function () {
      for (var i = 0; i < fallback.length; i++) {
        if (fallback[i].parentNode === el) el.removeChild(fallback[i])
      }
    })
    el.appendChild(iframe)
    frames[id] = { iframe: iframe, fixed: fixed !== null }
    var handle = {
      iframe: iframe,
      unmount: function () {
        delete frames[id]
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
        el.__snakieEmbed = null
      }
    }
    el.__snakieEmbed = handle
    return handle
  }

  // A URL this long is refused by some servers and proxies; a host should
  // offer "Open in Snakie" for a block that big instead.
  var MAX_UPGRADE_URL = 12000

  /**
   * Turn a plain code block into a live box in place ("Run here", #1319).
   * `el` is the block: a <pre>, its <code>, or a wrapper round them. Its text
   * becomes the program; opts are mount()'s (name, board, view, theme, …), and
   * the program runs straight away unless opts.autorun is false. The block is
   * hidden, not removed: unmount() takes the box away and shows it again.
   * Returns { iframe, box, unmount() }, or null if the block can't be upgraded.
   */
  function upgrade(el, opts) {
    if (!el || !el.parentNode) return null
    if (el.__snakieUpgrade) return el.__snakieUpgrade
    var codeEl = (el.querySelector && el.querySelector('code')) || el
    var code = String(codeEl.textContent || '').replace(/\s+$/, '')
    if (!code) return null
    var o = {}
    for (var k in opts || {}) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k]
    o.code = code
    if (!o.name) o.name = 'main.py'
    if (o.autorun === undefined) o.autorun = true
    if (embedUrl(o, 'x').length > MAX_UPGRADE_URL) return null
    var box = document.createElement('div')
    box.className = 'snakie-box snakie-box--upgraded'
    el.parentNode.insertBefore(box, el)
    var shown = el.style.display
    el.style.display = 'none'
    var inner = mount(box, o)
    var handle = {
      iframe: inner.iframe,
      box: box,
      unmount: function () {
        inner.unmount()
        if (box.parentNode) box.parentNode.removeChild(box)
        el.style.display = shown
        el.__snakieUpgrade = null
      }
    }
    el.__snakieUpgrade = handle
    return handle
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN) return
    var data = e.data
    if (!data || data.source !== 'snakie-embed' || !data.id) return
    var entry = frames[data.id]
    if (!entry || entry.iframe.contentWindow !== e.source) return
    if (data.type === 'height' && !entry.fixed && typeof data.height === 'number') {
      entry.iframe.style.height = Math.max(120, Math.min(2000, Math.round(data.height))) + 'px'
    } else if (data.type === 'pin-hover') {
      // One frame points at a pin: the others on the page light it too, and
      // the page hears about it (a wiring picture can light the wire).
      var pins = pinNames(data.pins)
      hoverFrames(pins, data.id)
      announce('pin-hover', { pins: pins, id: data.id })
    } else if (data.type === 'pin-state') {
      // What the running code's pins are doing: a robot frame turns its joints.
      var states = pinStates(data.states)
      for (var other in frames) {
        if (other === data.id || !frames[other].iframe.contentWindow) continue
        frames[other].iframe.contentWindow.postMessage({ source: 'snakie-embed-host', type: 'pin-state', states: states }, ORIGIN)
      }
      announce('pin-state', { states: states, id: data.id })
    } else if (data.type === 'pins') {
      announce('pins', {
        id: data.id,
        file: typeof data.file === 'string' ? data.file.slice(0, 200) : '',
        pins: pinList(data.pins),
        unwired: data.unwired ? pinNames(data.unwired) : null,
        unused: data.unused ? pinNames(data.unused) : null
      })
    }
  })

  // --- Pins between frames (#1320) ---
  // Only pin names and numbers cross: nothing a frame says is used as markup.
  var PIN_RE = /^[A-Za-z0-9_]{1,16}$/

  function pinNames(list) {
    var out = []
    if (!list || typeof list.length !== 'number') return out
    for (var i = 0; i < list.length && out.length < 40; i++) {
      if (typeof list[i] === 'string' && PIN_RE.test(list[i])) out.push(list[i])
    }
    return out
  }

  function pinStates(states) {
    var out = {}
    if (!states || typeof states !== 'object') return out
    var n = 0
    for (var pin in states) {
      if (!Object.prototype.hasOwnProperty.call(states, pin) || !PIN_RE.test(pin) || n++ >= 40) continue
      var st = states[pin]
      if (!st || (st.kind !== 'p' && st.kind !== 'w') || typeof st.value !== 'number' || !isFinite(st.value)) continue
      out[pin] = { kind: st.kind, value: st.value }
    }
    return out
  }

  function pinList(list) {
    var out = []
    if (!list || typeof list.length !== 'number') return out
    for (var i = 0; i < list.length && out.length < 40; i++) {
      var p = list[i]
      if (!p || typeof p.id !== 'string' || !PIN_RE.test(p.id)) continue
      out.push({
        id: p.id,
        kind: typeof p.kind === 'string' ? p.kind.slice(0, 40) : '',
        onBoard: p.onBoard !== false,
        part: typeof p.part === 'string' ? p.part.slice(0, 120) : null
      })
    }
    return out
  }

  /** Light these pins in every frame but the one that said so. */
  function hoverFrames(pins, exceptId) {
    for (var id in frames) {
      if (id === exceptId || !frames[id].iframe.contentWindow) continue
      frames[id].iframe.contentWindow.postMessage({ source: 'snakie-embed-host', type: 'pin-hover', pins: pins }, ORIGIN)
    }
  }

  /** Tell the page: document gets a `snakie:<name>` event with the detail. */
  function announce(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent('snakie:' + name, { detail: detail }))
    } catch (e) {
      /* a page too old for CustomEvent just doesn't hear it */
    }
  }

  /**
   * The page's own way in: SnakieEmbed.hover(['GP15']) lights that pin in
   * every code frame (a wire the reader is pointing at, say); hover([]) clears.
   */
  function hover(pins) {
    hoverFrames(pinNames(pins || []), null)
  }

  var SELECTOR = '[data-snakie-gist],[data-snakie-repo],[data-snakie-code],[data-snakie-robot]'
  var observer =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          function (entries) {
            for (var i = 0; i < entries.length; i++) {
              if (!entries[i].isIntersecting) continue
              observer.unobserve(entries[i].target)
              mount(entries[i].target)
            }
          },
          { rootMargin: '400px 0px' }
        )
      : null

  function scan(root) {
    var els = (root || document).querySelectorAll(SELECTOR)
    for (var i = 0; i < els.length; i++) {
      var el = els[i]
      if (el.__snakieSeen) continue
      el.__snakieSeen = true
      if (observer) observer.observe(el)
      else mount(el)
    }
  }

  window.SnakieEmbed = {
    version: '1',
    origin: ORIGIN,
    mount: mount,
    upgrade: upgrade,
    scan: scan,
    hover: hover,
    // This copy draws robot frames (#1321); a page checks before asking for one.
    robot: true,
    url: embedUrl,
    widths: WIDTHS,
    heights: HEIGHTS
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan() })
  else scan()
})()
