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
 * packages, code, name) is passed through as a URL parameter.
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
 * elements under root. No dependencies; MIT.
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
    'view', 'views', 'toolbox', 'run', 'autorun', 'theme', 'height', 'engine', 'packages'
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
    iframe.title = opts.title || (opts.file || opts.path || opts.name || 'Code') + ' in Snakie'
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

  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN) return
    var data = e.data
    if (!data || data.source !== 'snakie-embed' || !data.id) return
    var entry = frames[data.id]
    if (!entry || entry.iframe.contentWindow !== e.source) return
    if (data.type === 'height' && !entry.fixed && typeof data.height === 'number') {
      entry.iframe.style.height = Math.max(120, Math.min(2000, Math.round(data.height))) + 'px'
    }
  })

  var SELECTOR = '[data-snakie-gist],[data-snakie-repo],[data-snakie-code]'
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
    scan: scan,
    url: embedUrl,
    widths: WIDTHS,
    heights: HEIGHTS
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan() })
  else scan()
})()
