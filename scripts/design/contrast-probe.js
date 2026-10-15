// Rendered contrast probe — injected into a running Snakie page by
// scripts/design/rendered-contrast.py. Returns one record per visible element that
// carries its own text, with the WCAG contrast ratio of its text against the
// background actually painted behind it.
//
// Background is resolved by stacking order, not DOM ancestry: we take
// document.elementsFromPoint() at the text's centre and blend every layer's
// background-color from the top down until the result is opaque. Gradients are
// scored against each of their stops and the WORST stop is kept. A url() image
// layer (texture, photo) is flagged as `image` so the record can be reviewed by
// eye rather than trusted.
;(() => {
  function parse(c) {
    if (!c) return null
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  function over(top, under) {
    const a = top.a + under.a * (1 - top.a)
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
    const mix = (k) => (top[k] * top.a + under[k] * under.a * (1 - top.a)) / a
    return { r: mix('r'), g: mix('g'), b: mix('b'), a }
  }
  const lin = (v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

  // Colours inside a gradient, as rgba objects (computed style serialises them as rgb()/rgba()).
  function gradientStops(img) {
    return [...img.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0])).filter(Boolean)
  }

  function ownText(el) {
    let t = ''
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent
    return t.replace(/\s+/g, ' ').trim()
  }

  function visible(el, cs, r) {
    if (r.width < 2 || r.height < 2) return false
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false
    let o = 1
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity)
    return o > 0.05
  }

  function cumulativeOpacity(el) {
    let o = 1
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity)
    return o
  }

  function keyOf(el) {
    // stable-ish identifier for the same element across themes
    const parts = []
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      const cls = [...e.classList].filter((c) => !/^(is-|active|hover|open|monaco-|mtk|view-line)/.test(c)).slice(0, 2).join('.')
      parts.unshift(e.tagName.toLowerCase() + (cls ? '.' + cls : ''))
    }
    return parts.join(' > ')
  }

  function background(el, x, y) {
    const stack = document.elementsFromPoint(x, y)
    let i = stack.indexOf(el)
    if (i < 0) i = 0
    const layers = [] // top-down list of {color, gradient, image}
    for (let k = i; k < stack.length; k++) {
      const cs = getComputedStyle(stack[k])
      const col = parse(cs.backgroundColor)
      const img = cs.backgroundImage
      const layer = { color: col && col.a > 0 ? col : null, gradient: null, image: false }
      if (img && img !== 'none') {
        if (/gradient/.test(img)) layer.gradient = gradientStops(img)
        if (/url\(/.test(img)) layer.image = true
      }
      layers.push(layer)
      const opaque = (col && col.a >= 0.99) || (layer.gradient && layer.gradient.length && layer.gradient.every((s) => s.a >= 0.99))
      if (opaque) break
    }
    // compose: try each gradient stop as the representative of its layer (worst case kept by caller)
    const variants = [[]]
    for (const L of layers) {
      const opts = []
      if (L.gradient && L.gradient.length) for (const s of L.gradient) opts.push(L.color ? over(s, L.color) : s)
      else opts.push(L.color)
      const next = []
      for (const v of variants) for (const o of opts.slice(0, 4)) next.push([...v, o])
      variants.splice(0, variants.length, ...next.slice(0, 32))
    }
    const results = variants.map((v) => {
      let acc = { r: 255, g: 255, b: 255, a: 0 }
      for (let k = v.length - 1; k >= 0; k--) if (v[k]) acc = over(v[k], acc)
      if (acc.a < 1) acc = over(acc, { r: 255, g: 255, b: 255, a: 1 })
      return acc
    })
    return { results, image: layers.some((l) => l.image), gradient: layers.some((l) => l.gradient && l.gradient.length) }
  }

  const out = []
  const seen = new Set()
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.xterm-accessibility, [aria-hidden="true"] .sr-only, .sr-only')) continue
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'text' && el.tagName.toLowerCase() !== 'tspan') continue
    const text = ownText(el)
    if (!text || text.length < 1) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (!visible(el, cs, r)) continue
    const isSvg = el instanceof SVGElement
    let fg = parse(isSvg ? cs.fill : cs.color)
    if (!fg) continue
    fg = { ...fg, a: fg.a * cumulativeOpacity(el) }
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + Math.min(r.width / 2, 20)))
    const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))
    // Skip text that something else is painted over (a modal backdrop, a popover):
    // it is not what the user is reading at that moment.
    const topEl = document.elementFromPoint(x, y)
    if (topEl && !(el.contains(topEl) || topEl.contains(el))) continue
    const bg = background(el, x, y)
    let worst = Infinity
    let worstBg = null
    for (const b of bg.results) {
      const f = fg.a < 1 ? over(fg, b) : fg
      const cr = ratio(f, b)
      if (cr < worst) {
        worst = cr
        worstBg = b
      }
    }
    const size = parseFloat(cs.fontSize)
    const weight = parseInt(cs.fontWeight) || 400
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const disabled = el.closest('[disabled],[aria-disabled="true"]') !== null
    const key = keyOf(el) + ' :: ' + text.slice(0, 24)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      key,
      text: text.slice(0, 60),
      ratio: Math.round(worst * 100) / 100,
      need: large ? 3 : 4.5,
      fg: hex(fg.a < 1 ? over(fg, worstBg) : fg),
      bg: hex(worstBg),
      size,
      weight,
      disabled,
      gradient: bg.gradient,
      image: bg.image,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    })
  }
  return out
})()
