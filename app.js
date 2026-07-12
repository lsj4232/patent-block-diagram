'use strict'

const svg = document.getElementById('canvas')
const wrap = document.getElementById('wrap')

const FONT = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕','Noto Sans KR',sans-serif"
const SHADOW = 5   // 오프셋 음영 두께(px)
const FS = 15      // 폰트 크기
const LH = 20      // 줄 간격
const GRID = 5     // 스냅 격자

let state = { boxes: [], arrows: [], tags: [], nextId: 1 }
let selection = null        // { type: 'box'|'arrow'|'tag', id }
let arrowMode = false
let arrowSource = null
let lastArrowStyle = 'straight'
let undoStack = []

const $ = id => document.getElementById(id)
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const snap = v => Math.round(v / GRID) * GRID
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function uid() { return state.nextId++ }
function boxById(id) { return state.boxes.find(b => b.id === id) }
function center(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 } }

function pushUndo() {
  undoStack.push(JSON.stringify(state))
  if (undoStack.length > 100) undoStack.shift()
}

function undo() {
  if (!undoStack.length) return
  state = JSON.parse(undoStack.pop())
  selection = null
  arrowMode = false
  arrowSource = null
  render()
}

// ---------- 렌더링 ----------

function render() {
  let out = `<defs>
    <marker id="ah" viewBox="0 0 12 10" refX="11" refY="5" markerWidth="12" markerHeight="10" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L12,5 L0,10 Z" fill="black"/></marker>
    <marker id="ah-sel" viewBox="0 0 12 10" refX="11" refY="5" markerWidth="12" markerHeight="10" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L12,5 L0,10 Z" fill="#2b7de9"/></marker>
  </defs>`
  for (const a of state.arrows) out += renderArrow(a)
  for (const b of state.boxes) out += renderBox(b)
  for (const t of state.tags) out += renderTag(t)
  svg.innerHTML = out

  $('btn-arrow').classList.toggle('active', arrowMode)
  $('btn-style').disabled = !(selection && selection.type === 'arrow')
  $('btn-tag').disabled = !(selection && selection.type === 'box')
  $('btn-del').disabled = !selection
  syncEditField()
}

// 툴바 텍스트 편집창: 선택된 박스의 텍스트 / 태그의 부호를 실시간 편집
function editTarget() {
  if (!selection) return null
  if (selection.type === 'box') return boxById(selection.id)
  if (selection.type === 'tag') return state.tags.find(t => t.id === selection.id)
  return null
}

function syncEditField() {
  const et = $('edit-text')
  const target = editTarget()
  et.disabled = !target
  if (document.activeElement === et) return
  et.value = target ? (selection.type === 'box' ? target.text : target.label) : ''
}

function cylRy(b) { return Math.min(14, b.h / 4) }

// 도형 하나의 SVG 마크업 (음영용: stroke 없이 검정 채움 + 오프셋)
function shapeSVG(b, ox, oy, fill, stroke) {
  const x = b.x + ox, y = b.y + oy, w = b.w, h = b.h
  const st = stroke ? ` stroke="${stroke}" stroke-width="2"` : ''
  if (b.shape === 'round') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(14, h / 3)}" fill="${fill}"${st}/>`
  }
  if (b.shape === 'diamond') {
    return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" fill="${fill}"${st}/>`
  }
  if (b.shape === 'cylinder') {
    const ry = cylRy(b), rx = w / 2
    const sil = `M ${x} ${y + ry} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} L ${x + w} ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} Z`
    const rim = `M ${x} ${y + ry} A ${rx} ${ry} 0 0 0 ${x + w} ${y + ry}`
    return `<path d="${sil}" fill="${fill}"${st}/>` + (stroke ? `<path d="${rim}" fill="none"${st}/>` : '')
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${st}/>`
}

function renderBox(b) {
  const sel = selection && selection.type === 'box' && selection.id === b.id
  const src = arrowSource === b.id
  const stroke = src ? '#e2723a' : (sel ? '#2b7de9' : 'black')
  const lines = String(b.text).split('\n')
  const cy = b.shape === 'cylinder' ? b.y + cylRy(b) + b.h / 2 : b.y + b.h / 2
  const y0 = cy - (lines.length - 1) * LH / 2
  const texts = lines.map((ln, i) =>
    `<text x="${b.x + b.w / 2}" y="${y0 + i * LH}" text-anchor="middle" dominant-baseline="central" font-size="${FS}">${esc(ln)}</text>`
  ).join('')
  return `<g data-type="box" data-id="${b.id}" class="el">
    ${shapeSVG(b, SHADOW, SHADOW, 'black', null)}
    ${shapeSVG(b, 0, 0, 'white', stroke)}
    ${texts}
    ${sel ? `<rect data-type="resize" data-id="${b.id}" x="${b.x + b.w - 6}" y="${b.y + b.h - 6}" width="12" height="12" fill="#2b7de9"/>` : ''}
  </g>`
}

// 직선 화살표: 두 박스 중심을 잇는 선이 테두리와 만나는 점
function borderPoint(b, p) {
  const c = center(b)
  const dx = p.x - c.x, dy = p.y - c.y
  if (!dx && !dy) return c
  if (b.shape === 'diamond') {
    const k = Math.abs(dx) / (b.w / 2) + Math.abs(dy) / (b.h / 2)
    return { x: c.x + dx / k, y: c.y + dy / k }
  }
  const sx = dx !== 0 ? (b.w / 2) / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? (b.h / 2) / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return { x: c.x + dx * s, y: c.y + dy * s }
}

function arrowPoints(a, s, t) {
  const sc = center(s), tc = center(t)
  if (a.style === 'ortho') {
    if (Math.abs(tc.x - sc.x) >= Math.abs(tc.y - sc.y)) {
      const x1 = tc.x >= sc.x ? s.x + s.w : s.x
      const x2 = tc.x >= sc.x ? t.x : t.x + t.w
      if (sc.y === tc.y) return [{ x: x1, y: sc.y }, { x: x2, y: tc.y }]
      const mx = (x1 + x2) / 2
      return [{ x: x1, y: sc.y }, { x: mx, y: sc.y }, { x: mx, y: tc.y }, { x: x2, y: tc.y }]
    } else {
      const y1 = tc.y >= sc.y ? s.y + s.h : s.y
      const y2 = tc.y >= sc.y ? t.y : t.y + t.h
      if (sc.x === tc.x) return [{ x: sc.x, y: y1 }, { x: tc.x, y: y2 }]
      const my = (y1 + y2) / 2
      return [{ x: sc.x, y: y1 }, { x: sc.x, y: my }, { x: tc.x, y: my }, { x: tc.x, y: y2 }]
    }
  }
  return [borderPoint(s, tc), borderPoint(t, sc)]
}

function renderArrow(a) {
  const s = boxById(a.from), t = boxById(a.to)
  if (!s || !t) return ''
  const sel = selection && selection.type === 'arrow' && selection.id === a.id
  const pts = arrowPoints(a, s, t)
  const d = 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ')
  const col = sel ? '#2b7de9' : 'black'
  return `<g data-type="arrow" data-id="${a.id}" class="el">
    <path d="${d}" fill="none" stroke="transparent" stroke-width="14"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="2" marker-end="url(#${sel ? 'ah-sel' : 'ah'})"/>
  </g>`
}

// 부호 태그가 박스 테두리에 닿는 지점
function nearestBorderPoint(b, p) {
  if (b.shape === 'diamond') return borderPoint(b, p)
  const x = clamp(p.x, b.x, b.x + b.w)
  const y = clamp(p.y, b.y, b.y + b.h)
  if (x !== p.x || y !== p.y) return { x, y }
  const dl = p.x - b.x, dr = b.x + b.w - p.x, dt = p.y - b.y, db = b.y + b.h - p.y
  const m = Math.min(dl, dr, dt, db)
  if (m === dl) return { x: b.x, y: p.y }
  if (m === dr) return { x: b.x + b.w, y: p.y }
  if (m === dt) return { x: p.x, y: b.y }
  return { x: p.x, y: b.y + b.h }
}

function renderTag(tg) {
  const b = boxById(tg.boxId)
  if (!b) return ''
  const sel = selection && selection.type === 'tag' && selection.id === tg.id
  const col = sel ? '#2b7de9' : 'black'
  const L = { x: b.x + tg.dx, y: b.y + tg.dy }       // 부호 숫자 위치
  const A = nearestBorderPoint(b, L)                  // 박스 테두리 접점
  const vx = L.x - A.x, vy = L.y - A.y
  const len = Math.hypot(vx, vy) || 1
  const ux = vx / len, uy = vy / len
  const end = { x: L.x - ux * 14, y: L.y - uy * 14 }  // 숫자 직전에서 물결선 종료
  const l2 = Math.hypot(end.x - A.x, end.y - A.y)
  const amp = Math.min(7, l2 / 3)
  const nx = -uy, ny = ux
  const c1 = { x: A.x + ux * l2 / 3 + nx * amp, y: A.y + uy * l2 / 3 + ny * amp }
  const c2 = { x: A.x + ux * l2 * 2 / 3 - nx * amp, y: A.y + uy * l2 * 2 / 3 - ny * amp }
  return `<g data-type="tag" data-id="${tg.id}" class="el">
    <path d="M ${A.x} ${A.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}" fill="none" stroke="${col}" stroke-width="1.5"/>
    <text x="${L.x}" y="${L.y}" text-anchor="middle" dominant-baseline="central" font-size="${FS}" fill="${col}">${esc(tg.label)}</text>
  </g>`
}

// ---------- 조작 ----------

function pt(e) {
  const r = svg.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function drag(e0, onMove) {
  let pushed = false
  const p0 = pt(e0)
  const move = ev => {
    const p = pt(ev)
    if (!pushed && (Math.abs(p.x - p0.x) > 2 || Math.abs(p.y - p0.y) > 2)) {
      pushUndo()
      pushed = true
    }
    if (pushed) { onMove(p.x - p0.x, p.y - p0.y); render() }
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// mousedown 시 re-render로 클릭 대상이 파괴되어 브라우저 dblclick이 발생하지 않으므로 직접 감지
let lastDown = { t: 0, x: 0, y: 0 }

svg.addEventListener('mousedown', e => {
  const g = e.target.closest('[data-type]')

  if (arrowMode) {
    if (g && g.dataset.type === 'box') {
      const id = +g.dataset.id
      if (arrowSource == null) {
        arrowSource = id
      } else if (arrowSource !== id) {
        pushUndo()
        const a = { id: uid(), from: arrowSource, to: id, style: lastArrowStyle }
        state.arrows.push(a)
        arrowMode = false
        arrowSource = null
        selection = { type: 'arrow', id: a.id }
      }
      render()
    }
    return
  }

  const p = pt(e)
  const now = Date.now()
  const isDbl = now - lastDown.t < 400 && Math.abs(p.x - lastDown.x) < 6 && Math.abs(p.y - lastDown.y) < 6
  lastDown = { t: now, x: p.x, y: p.y }
  if (isDbl) {
    lastDown.t = 0
    if (!g) {
      pushUndo()
      const b = { id: uid(), x: snap(p.x - 80), y: snap(p.y - 30), w: 160, h: 60, text: '블록' }
      state.boxes.push(b)
      selection = { type: 'box', id: b.id }
      render()
      editBoxText(b)
    } else if (g.dataset.type === 'box') {
      editBoxText(boxById(+g.dataset.id))
    } else if (g.dataset.type === 'tag') {
      editTagLabel(state.tags.find(t => t.id === +g.dataset.id))
    }
    return
  }

  if (!g) { selection = null; render(); return }
  const type = g.dataset.type
  const id = +g.dataset.id

  if (type === 'resize') {
    const b = boxById(id)
    const ow = b.w, oh = b.h
    drag(e, (dx, dy) => {
      b.w = Math.max(40, snap(ow + dx))
      b.h = Math.max(30, snap(oh + dy))
    })
    return
  }

  selection = { type, id }
  render()

  if (type === 'box') {
    const b = boxById(id)
    const ox = b.x, oy = b.y
    drag(e, (dx, dy) => { b.x = snap(ox + dx); b.y = snap(oy + dy) })
  } else if (type === 'tag') {
    const tg = state.tags.find(t => t.id === id)
    const odx = tg.dx, ody = tg.dy
    drag(e, (dx, dy) => { tg.dx = odx + dx; tg.dy = ody + dy })
  }
})

function editBoxText(b) {
  const ta = document.createElement('textarea')
  ta.className = 'overlay-edit'
  Object.assign(ta.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' })
  ta.value = b.text
  let done = false, cancel = false
  const commit = () => {
    if (done) return
    done = true
    if (!cancel && ta.value !== b.text) { pushUndo(); b.text = ta.value }
    ta.remove()
    render()
  }
  ta.addEventListener('blur', commit)
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { cancel = true; ta.blur() }
    ev.stopPropagation()
  })
  wrap.appendChild(ta)
  ta.focus()
  ta.select()
}

function editTagLabel(tg) {
  const b = boxById(tg.boxId)
  const inp = document.createElement('input')
  inp.className = 'overlay-edit'
  Object.assign(inp.style, { left: (b.x + tg.dx - 35) + 'px', top: (b.y + tg.dy - 14) + 'px', width: '70px', height: '28px', paddingTop: '0' })
  inp.value = tg.label
  let done = false, cancel = false
  const commit = () => {
    if (done) return
    done = true
    if (!cancel && inp.value !== tg.label) { pushUndo(); tg.label = inp.value }
    inp.remove()
    render()
  }
  inp.addEventListener('blur', commit)
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { cancel = true; inp.blur() }
    if (ev.key === 'Enter') inp.blur()
    ev.stopPropagation()
  })
  wrap.appendChild(inp)
  inp.focus()
  inp.select()
}

// ---------- 툴바 동작 ----------

const SHAPE_DEFAULTS = {
  rect: { w: 160, h: 60 },
  round: { w: 160, h: 60 },
  diamond: { w: 160, h: 90 },
  cylinder: { w: 140, h: 90 }
}

function addBox(shape = 'rect') {
  pushUndo()
  const n = state.boxes.length
  const d = SHAPE_DEFAULTS[shape] || SHAPE_DEFAULTS.rect
  const b = { id: uid(), x: 80 + (n % 5) * 30, y: 80 + (n % 5) * 30, w: d.w, h: d.h, text: '블록', shape }
  state.boxes.push(b)
  selection = { type: 'box', id: b.id }
  render()
}

function nextLabel() {
  const used = new Set(state.tags.map(t => t.label))
  let n = 100
  while (used.has(String(n))) n += 10
  return String(n)
}

function addTag() {
  if (!selection || selection.type !== 'box') return
  pushUndo()
  const b = boxById(selection.id)
  const tg = { id: uid(), boxId: b.id, label: nextLabel(), dx: b.w + 45, dy: -18 }
  state.tags.push(tg)
  selection = { type: 'tag', id: tg.id }
  render()
}

function toggleStyle() {
  if (!selection || selection.type !== 'arrow') return
  pushUndo()
  const a = state.arrows.find(a => a.id === selection.id)
  a.style = a.style === 'ortho' ? 'straight' : 'ortho'
  lastArrowStyle = a.style
  render()
}

function deleteSelection() {
  if (!selection) return
  pushUndo()
  const { type, id } = selection
  if (type === 'box') {
    state.boxes = state.boxes.filter(b => b.id !== id)
    state.arrows = state.arrows.filter(a => a.from !== id && a.to !== id)
    state.tags = state.tags.filter(t => t.boxId !== id)
  } else if (type === 'arrow') {
    state.arrows = state.arrows.filter(a => a.id !== id)
  } else if (type === 'tag') {
    state.tags = state.tags.filter(t => t.id !== id)
  }
  selection = null
  render()
}

// ---------- 저장 / 열기 / 내보내기 ----------

async function save() {
  const data = JSON.stringify(state, null, 2)
  if (window.api) {
    await window.api.saveJSON(data)
  } else {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    a.download = '도면.json'
    a.click()
  }
}

async function load() {
  let text = null
  if (window.api) {
    text = await window.api.loadJSON()
  } else {
    text = await new Promise(res => {
      const i = document.createElement('input')
      i.type = 'file'
      i.accept = '.json'
      i.onchange = () => {
        const f = i.files[0]
        if (!f) return res(null)
        const r = new FileReader()
        r.onload = () => res(r.result)
        r.readAsText(f)
      }
      i.click()
    })
  }
  if (!text) return
  try {
    const s = JSON.parse(text)
    if (!Array.isArray(s.boxes)) throw new Error('bad file')
    pushUndo()
    state = s
    selection = null
    render()
  } catch {
    alert('파일을 읽을 수 없습니다.')
  }
}

function renderPNGDataURL(scale) {
  return new Promise((resolve, reject) => {
    const prevSel = selection, prevSrc = arrowSource
    selection = null
    arrowSource = null
    render()
    const bb = svg.getBBox()
    const inner = svg.innerHTML
    selection = prevSel
    arrowSource = prevSrc
    render()

    const m = 20
    const x = bb.x - m, y = bb.y - m, w = bb.width + 2 * m, h = bb.height + 2 * m
    const str = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}" font-family="${esc(FONT)}">` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>` + inner + `</svg>`

    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = Math.round(w * scale)
      c.height = Math.round(h * scale)
      const ctx = c.getContext('2d')
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str)
  })
}

async function exportPNG() {
  if (!state.boxes.length) return
  const dataURL = await renderPNGDataURL(3)
  if (window.api) {
    await window.api.exportPNG(dataURL)
  } else {
    const a = document.createElement('a')
    a.href = dataURL
    a.download = '도면.png'
    a.click()
  }
}

// ---------- 키보드 / 버튼 배선 ----------

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection() }
  else if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo() }
  else if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save() }
  else if (e.key === 'Escape') { arrowMode = false; arrowSource = null; selection = null; render() }
})

{
  const et = $('edit-text')
  let pushed = false
  et.addEventListener('focus', () => { pushed = false })
  et.addEventListener('input', () => {
    const target = editTarget()
    if (!target) return
    if (!pushed) { pushUndo(); pushed = true }
    if (selection.type === 'box') target.text = et.value
    else target.label = et.value
    render()
  })
  et.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') et.blur()
    ev.stopPropagation()
  })
}

$('btn-box').onclick = () => addBox('rect')
$('btn-round').onclick = () => addBox('round')
$('btn-diamond').onclick = () => addBox('diamond')
$('btn-cyl').onclick = () => addBox('cylinder')
$('btn-arrow').onclick = () => { arrowMode = !arrowMode; arrowSource = null; render() }
$('btn-tag').onclick = addTag
$('btn-style').onclick = toggleStyle
$('btn-del').onclick = deleteSelection
$('btn-save').onclick = save
$('btn-open').onclick = load
$('btn-png').onclick = exportPNG

render()

// 개발/테스트용 훅
window._app = {
  get state() { return state },
  set state(s) { state = s; render() },
  render,
  renderPNGDataURL
}
