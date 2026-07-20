'use strict'

const svg = document.getElementById('canvas')
const wrap = document.getElementById('wrap')

const FONT = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕','Noto Sans KR',sans-serif"
const SHADOW = 5   // 오프셋 음영 두께(px)
const FS = 15      // 폰트 크기
const LH = 20      // 줄 간격
const GRID = 5     // 스냅 격자

let state = { boxes: [], arrows: [], tags: [], nextId: 1 }
let selection = null        // 주 선택 { type: 'box'|'arrow'|'tag', id } — 툴바·텍스트 편집창의 대상
let multi = []              // 선택 전체 (주 선택 포함). Ctrl+A·Shift+클릭으로 여러 개가 된다
let arrowMode = false
let arrowSource = null
let lastArrowStyle = 'straight'
let undoStack = []
let zoom = 1                          // 화면 확대 배율 (도면 데이터에는 영향 없음)
const ZOOM_MIN = 0.25, ZOOM_MAX = 4

const $ = id => document.getElementById(id)
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const snap = v => Math.round(v / GRID) * GRID
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function uid() { return state.nextId++ }

// ---------- 선택 (단일 / 다중) ----------
// selection 은 주 선택(툴바 상태와 텍스트 편집창이 따라간다), multi 는 선택된 전체 목록.
// 하나만 고른 평범한 경우 multi 는 [selection] 한 개짜리다.
function setSelection(s) { selection = s; multi = s ? [s] : [] }
function clearSelection() { selection = null; multi = [] }
function isSelected(type, id) { return multi.some(s => s.type === type && s.id === id) }
function toggleSelection(type, id) {
  const i = multi.findIndex(s => s.type === type && s.id === id)
  if (i >= 0) {
    multi.splice(i, 1)
    if (selection && selection.type === type && selection.id === id) selection = multi[multi.length - 1] || null
  } else {
    selection = { type, id }
    multi.push(selection)
  }
}
function selectAll() {
  multi = [
    ...state.boxes.map(b => ({ type: 'box', id: b.id })),
    ...state.arrows.map(a => ({ type: 'arrow', id: a.id })),
    ...state.tags.map(t => ({ type: 'tag', id: t.id }))
  ]
  selection = multi[0] || null
  render()
}
// 선택된 실제 객체들 (박스/화살표/태그 뒤섞임)
function selectedElements() {
  return multi.map(s => {
    if (s.type === 'box') return boxById(s.id)
    if (s.type === 'arrow') return state.arrows.find(a => a.id === s.id)
    return state.tags.find(t => t.id === s.id)
  }).filter(Boolean)
}

// ---------- z-order (화살표·박스·태그 통합 순서) ----------
function allEls() { return [...state.arrows, ...state.boxes, ...state.tags] }
// 저장 파일 등에 z가 없으면 현재 렌더 순서(화살표→박스→태그)대로 z 부여
function ensureZ() {
  const all = allEls()
  if (all.every(e => typeof e.z === 'number')) return
  let z = 1
  for (const e of all) e.z = z++
}
function zTop() { return allEls().reduce((m, e) => Math.max(m, e.z || 0), 0) }
function zBottom() { return allEls().reduce((m, e) => Math.min(m, e.z || 0), 0) }
function nextZ() { return zTop() + 1 }
function boxById(id) { return state.boxes.find(b => b.id === id) }
function center(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 } }

function pushUndo() {
  undoStack.push(JSON.stringify(state))
  if (undoStack.length > 100) undoStack.shift()
}

function undo() {
  if (!undoStack.length) return
  state = JSON.parse(undoStack.pop())
  clearSelection()
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
  ensureZ()
  const items = []
  state.arrows.forEach(a => items.push({ z: a.z, s: renderArrow(a) }))
  state.boxes.forEach(b => items.push({ z: b.z, s: renderBox(b) }))
  state.tags.forEach(t => items.push({ z: t.z, s: renderTag(t) }))
  items.sort((p, q) => p.z - q.z)   // z 오름차순: 작을수록 아래, 클수록 위
  for (const it of items) out += it.s
  out += endpointHandles()          // 조작 핸들은 항상 최상단
  svg.innerHTML = out
  fitCanvas()

  $('btn-arrow').classList.toggle('active', arrowMode)
  $('btn-style').disabled = !(selection && selection.type === 'arrow')
  const boxSel = multi.some(s => s.type === 'box')
  $('btn-dash').disabled = !boxSel
  $('btn-frame').disabled = !boxSel
  $('btn-ep-reset').disabled = !(selection && selection.type === 'arrow' &&
    (() => { const a = state.arrows.find(a => a.id === selection.id); return a && (a.fromOff || a.toOff) })())
  $('btn-tag').disabled = !(multi.length === 1 && selection && selection.type === 'box')
  $('btn-front').disabled = !multi.length
  $('btn-back').disabled = !multi.length
  $('btn-del').disabled = !multi.length
  const hasText = fontTargets().length > 0
  $('btn-fs-down').disabled = !hasText
  $('btn-fs-up').disabled = !hasText
  $('btn-fs-reset').disabled = !hasText
  $('fs-label').textContent = fontLabel()
  $('sel-label').textContent = multi.length > 1 ? multi.length + '개 선택' : ''
  syncEditField()
}

// 캔버스는 기본 2400x1600이되, 도면이 그보다 크면 내용을 다 담도록 늘린다
// (안 늘리면 오른쪽·아래쪽 요소가 SVG 밖으로 잘려 보이지도, 잡히지도 않는다)
const CANVAS_MIN_W = 2400, CANVAS_MIN_H = 1600, CANVAS_PAD = 120
function fitCanvas() {
  let mx = 0, my = 0
  for (const b of state.boxes) { mx = Math.max(mx, b.x + b.w); my = Math.max(my, b.y + b.h) }
  for (const t of state.tags) {
    const b = boxById(t.boxId)
    if (!b) continue
    const fs = fsOf(t)
    mx = Math.max(mx, b.x + t.dx + textWidth(t.label, fs) / 2 + 10)
    my = Math.max(my, b.y + t.dy + fs)
  }
  const w = Math.max(CANVAS_MIN_W, Math.ceil(mx + CANVAS_PAD))
  const h = Math.max(CANVAS_MIN_H, Math.ceil(my + CANVAS_PAD))
  if (+svg.getAttribute('width') !== w) svg.setAttribute('width', w)
  if (+svg.getAttribute('height') !== h) svg.setAttribute('height', h)
  // wrap 도 같이 늘려야 스크롤 범위가 따라온다 (CSS 고정 크기를 덮어쓴다)
  wrap.style.width = w + 'px'
  wrap.style.height = h + 'px'
}

// 툴바 텍스트 편집창: 선택된 박스의 텍스트 / 태그의 부호를 실시간 편집
function editTarget() {
  if (!selection || multi.length > 1) return null   // 여러 개 선택 중엔 텍스트 편집을 막는다
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
  const dash = b.dash ? ` stroke-dasharray="12 7"` : ''
  const st = stroke ? ` stroke="${stroke}" stroke-width="2"${dash}` : ''
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

// 요소별 폰트 크기 (fs 가 없으면 기본값 FS). 줄 간격은 폰트에 비례해 따라간다
function fsOf(el) { return (el && typeof el.fs === 'number') ? el.fs : FS }
function lhOf(el) { return Math.round(fsOf(el) * LH / FS) }

function renderBox(b) {
  const sel = isSelected('box', b.id)
  const src = arrowSource === b.id
  const stroke = src ? '#e2723a' : (sel ? '#2b7de9' : 'black')
  const lines = String(b.text).split('\n')
  const fs = fsOf(b), lh = lhOf(b)
  // textTop: 다른 박스를 품는 컨테이너용 — 글자를 가운데가 아니라 위쪽에 붙인다
  const cy = b.textTop ? b.y + fs + 7 : (b.shape === 'cylinder' ? b.y + cylRy(b) + b.h / 2 : b.y + b.h / 2)
  const y0 = cy - (lines.length - 1) * lh / 2
  const texts = lines.map((ln, i) =>
    `<text x="${b.x + b.w / 2}" y="${y0 + i * lh}" text-anchor="middle" dominant-baseline="central" font-size="${fs}" font-weight="bold">${esc(ln)}</text>`
  ).join('')
  // noFrame: 테두리·음영·채움 없는 순수 글자 상자 (도면 주석·라벨용).
  // 그려지는 게 글자뿐이라 잡을 곳이 없으므로 투명 사각형을 깔아 클릭 영역을 만든다.
  // 선택 중일 때만 파선 안내틀을 덧그린다 — 내보내기 직전에 선택이 해제되므로 PNG에는 안 나온다.
  const body = b.noFrame
    ? `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="transparent"/>` +
      (sel || src ? `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4 4"/>` : '')
    : (b.dash ? '' : shapeSVG(b, SHADOW, SHADOW, 'black', null)) +
      shapeSVG(b, 0, 0, b.dash ? 'none' : 'white', stroke)
  return `<g data-type="box" data-id="${b.id}" class="el">
    ${body}
    ${texts}
    ${sel && multi.length === 1 ? `<rect data-type="resize" data-id="${b.id}" x="${b.x + b.w - 6}" y="${b.y + b.h - 6}" width="12" height="12" fill="#2b7de9"/>` : ''}
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

// 손으로 옮긴 끝점(fromOff/toOff)은 박스 좌상단 기준 상대좌표 → 박스를 옮겨도 따라온다
function manualPoint(off, b) {
  return off ? { x: b.x + off.dx, y: b.y + off.dy } : null
}

// 끝점이 손으로 지정된 경우의 직각 경로
function orthoPath(p0, p1) {
  if (p0.x === p1.x || p0.y === p1.y) return [p0, p1]
  if (Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y)) {
    const mx = (p0.x + p1.x) / 2
    return [p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1]
  }
  const my = (p0.y + p1.y) / 2
  return [p0, { x: p0.x, y: my }, { x: p1.x, y: my }, p1]
}

// 화살표의 실제 꺾임점 목록 (끝점을 손으로 옮겼으면 그 점을 그대로 쓴다)
function arrowPath(a, s, t) {
  const fp = manualPoint(a.fromOff, s)
  const tp = manualPoint(a.toOff, t)
  if (!fp && !tp) return arrowPoints(a, s, t)
  const p0 = fp || borderPoint(s, tp)      // 한쪽만 수동이면 나머지는 그 점을 향하는 테두리점
  const p1 = tp || borderPoint(t, fp)
  return a.style === 'ortho' ? orthoPath(p0, p1) : [p0, p1]
}

function renderArrow(a) {
  const s = boxById(a.from), t = boxById(a.to)
  if (!s || !t) return ''
  const sel = isSelected('arrow', a.id)
  const pts = arrowPath(a, s, t)
  const d = 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ')
  const col = sel ? '#2b7de9' : 'black'
  return `<g data-type="arrow" data-id="${a.id}" class="el">
    <path d="${d}" fill="none" stroke="transparent" stroke-width="14"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="2" marker-end="url(#${sel ? 'ah-sel' : 'ah'})"/>
  </g>`
}

// 선택된 화살표의 끝점 핸들 — 박스에 가리지 않도록 z와 무관하게 항상 맨 위에 그린다
function endpointHandles() {
  if (multi.length !== 1 || !selection || selection.type !== 'arrow') return ''
  const a = state.arrows.find(a => a.id === selection.id)
  if (!a) return ''
  const s = boxById(a.from), t = boxById(a.to)
  if (!s || !t) return ''
  const pts = arrowPath(a, s, t)
  const h = (p, end) =>
    `<rect data-type="ep" data-id="${a.id}" data-end="${end}" x="${p.x - 6}" y="${p.y - 6}" width="12" height="12" fill="white" stroke="#2b7de9" stroke-width="2"/>`
  return h(pts[0], 'from') + h(pts[pts.length - 1], 'to')
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

// 글자 실제 폭 측정 (지시선을 부호 글자에 물리지 않게 물러나게 하려면 필요)
const measureCtx = document.createElement('canvas').getContext('2d')
function textWidth(s, fs) {
  measureCtx.font = `bold ${fs}px ${FONT}`
  return measureCtx.measureText(String(s)).width
}

// 부호 글자를 감싸는 상자의 경계까지 거리 — 방향 (ux,uy)로 나갈 때 얼마나 물러나야 하는가.
// 고정값(예전 14px)을 쓰면 'S150' 처럼 넓은 부호에서 선이 글자를 파고든다.
function labelBackoff(label, fs, ux, uy) {
  const halfW = textWidth(label, fs) / 2 + 5   // 좌우 여백 5px
  const halfH = fs / 2 + 4                     // 상하 여백 4px
  const sx = ux !== 0 ? halfW / Math.abs(ux) : Infinity
  const sy = uy !== 0 ? halfH / Math.abs(uy) : Infinity
  return Math.min(sx, sy)
}

function renderTag(tg) {
  const b = boxById(tg.boxId)
  if (!b) return ''
  const sel = isSelected('tag', tg.id)
  const col = sel ? '#2b7de9' : 'black'
  const fs = fsOf(tg)
  const L = { x: b.x + tg.dx, y: b.y + tg.dy }       // 부호 숫자 위치
  const A = nearestBorderPoint(b, L)                  // 박스 테두리 접점
  const vx = L.x - A.x, vy = L.y - A.y
  const len = Math.hypot(vx, vy) || 1
  const ux = vx / len, uy = vy / len
  const back = labelBackoff(tg.label, fs, ux, uy)     // 글자 폭만큼 물러난다
  const text = `<text x="${L.x}" y="${L.y}" text-anchor="middle" dominant-baseline="central" font-size="${fs}" font-weight="bold" fill="${col}">${esc(tg.label)}</text>`
  // 부호를 박스에 바짝 붙여 놓으면 지시선이 들어갈 자리가 없다 — 이때는 선을 그리지 않는다
  if (len - back < 6) return `<g data-type="tag" data-id="${tg.id}" class="el">${text}</g>`
  const end = { x: L.x - ux * back, y: L.y - uy * back }
  const l2 = len - back
  const amp = Math.min(7, l2 / 3)
  const nx = -uy, ny = ux
  const c1 = { x: A.x + ux * l2 / 3 + nx * amp, y: A.y + uy * l2 / 3 + ny * amp }
  const c2 = { x: A.x + ux * l2 * 2 / 3 - nx * amp, y: A.y + uy * l2 * 2 / 3 - ny * amp }
  return `<g data-type="tag" data-id="${tg.id}" class="el">
    <path d="M ${A.x} ${A.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}" fill="none" stroke="${col}" stroke-width="1.5"/>
    ${text}
  </g>`
}

// ---------- 조작 ----------

// 화면 좌표 → 캔버스 좌표 (확대 배율 보정)
function pt(e) {
  const r = svg.getBoundingClientRect()
  return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }
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
        const a = { id: uid(), from: arrowSource, to: id, style: lastArrowStyle, z: nextZ() }
        state.arrows.push(a)
        arrowMode = false
        arrowSource = null
        setSelection({ type: 'arrow', id: a.id })
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
      const b = { id: uid(), x: snap(p.x - 80), y: snap(p.y - 30), w: 160, h: 60, text: '블록', z: nextZ() }
      state.boxes.push(b)
      setSelection({ type: 'box', id: b.id })
      render()
      editBoxText(b)
    } else if (g.dataset.type === 'box') {
      editBoxText(boxById(+g.dataset.id))
    } else if (g.dataset.type === 'tag') {
      editTagLabel(state.tags.find(t => t.id === +g.dataset.id))
    }
    return
  }

  if (!g) { clearSelection(); render(); return }
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

  // 화살표 끝점 핸들: 잡아끌면 그 지점으로 끝점이 고정된다 (기준 박스의 상대좌표로 저장)
  if (type === 'ep') {
    const a = state.arrows.find(a => a.id === id)
    const end = g.dataset.end                      // 'from' | 'to'
    const b = boxById(end === 'from' ? a.from : a.to)
    const key = end === 'from' ? 'fromOff' : 'toOff'
    const pts = arrowPath(a, boxById(a.from), boxById(a.to))
    const p0 = end === 'from' ? pts[0] : pts[pts.length - 1]
    const ox = p0.x - b.x, oy = p0.y - b.y
    drag(e, (dx, dy) => {
      a[key] = { dx: snap(ox + dx), dy: snap(oy + dy) }
    })
    return
  }

  if (e.shiftKey) {
    // Shift+클릭: 선택에 더하거나 뺀다 (드래그는 하지 않는다)
    toggleSelection(type, id)
    render()
    return
  }
  // 이미 선택된 것을 잡으면 선택을 유지한 채 묶음 전체를 끈다
  if (!isSelected(type, id)) setSelection({ type, id })
  else selection = { type, id }
  render()

  // 선택된 박스·태그를 함께 옮긴다 (화살표는 양 끝 박스를 따라가므로 대상 아님)
  const boxes = multi.filter(s => s.type === 'box').map(s => ({ b: boxById(s.id) })).filter(o => o.b)
  const tags = multi.filter(s => s.type === 'tag').map(s => ({ t: state.tags.find(t => t.id === s.id) })).filter(o => o.t)
  if (type === 'box' || type === 'tag') {
    boxes.forEach(o => { o.ox = o.b.x; o.oy = o.b.y })
    // 함께 옮겨지는 박스에 딸린 태그는 dx/dy가 상대좌표라 자동으로 따라온다 (이중 이동 방지)
    const movingBoxIds = new Set(boxes.map(o => o.b.id))
    const freeTags = tags.filter(o => !movingBoxIds.has(o.t.boxId))
    freeTags.forEach(o => { o.odx = o.t.dx; o.ody = o.t.dy })
    drag(e, (dx, dy) => {
      boxes.forEach(o => { o.b.x = snap(o.ox + dx); o.b.y = snap(o.oy + dy) })
      freeTags.forEach(o => { o.t.dx = o.odx + dx; o.t.dy = o.ody + dy })
    })
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
  cylinder: { w: 140, h: 90 },
  text: { w: 180, h: 40 }
}

function addBox(shape = 'rect') {
  pushUndo()
  const n = state.boxes.length
  const d = SHAPE_DEFAULTS[shape] || SHAPE_DEFAULTS.rect
  // 'text' 는 도형이 아니라 테두리 없는 글자 상자 — 실제 shape 는 rect 로 두고 noFrame 을 켠다
  const isText = shape === 'text'
  const b = {
    id: uid(), x: 80 + (n % 5) * 30, y: 80 + (n % 5) * 30, w: d.w, h: d.h,
    text: isText ? '텍스트' : '블록', shape: isText ? 'rect' : shape, z: nextZ()
  }
  if (isText) b.noFrame = true
  state.boxes.push(b)
  setSelection({ type: 'box', id: b.id })
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
  const tg = { id: uid(), boxId: b.id, label: nextLabel(), dx: b.w + 45, dy: -18, z: nextZ() }
  state.tags.push(tg)
  setSelection({ type: 'tag', id: tg.id })
  render()
}

// 선택한 박스의 테두리를 실선 ⇄ 점선 (점선 박스는 음영·흰 채움 없이 경계만 그린다 — 폐쇄망 같은 영역 표시용)
function selectedBoxes() { return multi.filter(s => s.type === 'box').map(s => boxById(s.id)).filter(Boolean) }

function toggleDash() {
  const boxes = selectedBoxes()
  if (!boxes.length) return
  pushUndo()
  // 섞여 있으면 전부 점선으로 맞춘다 (모두 점선일 때만 실선으로 되돌린다)
  const to = !boxes.every(b => b.dash)
  for (const b of boxes) { b.dash = to; if (to) delete b.noFrame }
  render()
}

// 테두리 자체를 없앤 투명 글자 상자로 전환 (음영·채움·선 모두 사라지고 글자만 남는다)
function toggleFrame() {
  const boxes = selectedBoxes()
  if (!boxes.length) return
  pushUndo()
  const to = !boxes.every(b => b.noFrame)
  for (const b of boxes) {
    if (to) { b.noFrame = true; delete b.dash }
    else delete b.noFrame
  }
  render()
}

// 손으로 옮긴 끝점을 버리고 자동 계산(박스 중심 기준)으로 되돌린다
function resetEndpoints() {
  if (!selection || selection.type !== 'arrow') return
  const a = state.arrows.find(a => a.id === selection.id)
  if (!a.fromOff && !a.toOff) return
  pushUndo()
  delete a.fromOff
  delete a.toOff
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
  if (!multi.length) return
  pushUndo()
  const boxIds = new Set(multi.filter(s => s.type === 'box').map(s => s.id))
  const arrowIds = new Set(multi.filter(s => s.type === 'arrow').map(s => s.id))
  const tagIds = new Set(multi.filter(s => s.type === 'tag').map(s => s.id))
  state.boxes = state.boxes.filter(b => !boxIds.has(b.id))
  // 지워진 박스에 붙어 있던 화살표·태그도 함께 사라진다
  state.arrows = state.arrows.filter(a => !arrowIds.has(a.id) && !boxIds.has(a.from) && !boxIds.has(a.to))
  state.tags = state.tags.filter(t => !tagIds.has(t.id) && !boxIds.has(t.boxId))
  clearSelection()
  render()
}

// 선택 요소를 종류 구분 없이 전체 최상단/최하단으로 이동 (통합 z-order)
function reorderSelection(dir) {
  if (!multi.length) return
  ensureZ()
  const els = selectedElements()
  if (!els.length) return
  pushUndo()
  // 여러 개를 함께 옮길 때도 자기들끼리의 상하 관계는 유지한다
  els.sort((p, q) => p.z - q.z)
  if (dir === 'front') { let z = zTop() + 1; for (const el of els) el.z = z++ }
  else { let z = zBottom() - els.length; for (const el of els) el.z = z++ }
  render()
}

// ---------- 글자 크기 ----------

const FS_MIN = 8, FS_MAX = 72
// 텍스트를 가진 선택 요소 (박스·태그). 화살표는 글자가 없다
function fontTargets() { return selectedElements().filter(el => el && ('text' in el || 'label' in el)) }
function changeFontSize(delta) {
  const els = fontTargets()
  if (!els.length) return
  pushUndo()
  for (const el of els) el.fs = clamp(fsOf(el) + delta, FS_MIN, FS_MAX)
  render()
}
function resetFontSize() {
  const els = fontTargets()
  if (!els.length) return
  pushUndo()
  for (const el of els) delete el.fs
  render()
}
// 툴바 표시: 선택된 것들의 크기가 제각각이면 "혼합"
function fontLabel() {
  const els = fontTargets()
  if (!els.length) return '-'
  const sizes = new Set(els.map(fsOf))
  return sizes.size === 1 ? String([...sizes][0]) : '혼합'
}

// ---------- 복사 / 붙여넣기 ----------

let clipboard = null   // { type: 'box'|'tag', data, count }

function copySelection() {
  if (!selection) return
  if (selection.type === 'box') {
    const b = boxById(selection.id)
    if (b) clipboard = { type: 'box', data: JSON.parse(JSON.stringify(b)), count: 0 }
  } else if (selection.type === 'tag') {
    const t = state.tags.find(t => t.id === selection.id)
    if (t) clipboard = { type: 'tag', data: JSON.parse(JSON.stringify(t)), count: 0 }
  }
}

function pasteClipboard() {
  if (!clipboard) return
  if (clipboard.type === 'tag' && !boxById(clipboard.data.boxId)) return
  pushUndo()
  clipboard.count++
  const off = 20 * clipboard.count
  if (clipboard.type === 'box') {
    const b = { ...clipboard.data, id: uid(), x: clipboard.data.x + off, y: clipboard.data.y + off, z: nextZ() }
    state.boxes.push(b)
    setSelection({ type: 'box', id: b.id })
  } else {
    const t = { ...clipboard.data, id: uid(), dx: clipboard.data.dx + off, dy: clipboard.data.dy + off, label: nextLabel(), z: nextZ() }
    state.tags.push(t)
    setSelection({ type: 'tag', id: t.id })
  }
  render()
}

// ---------- 저장 / 열기 / 내보내기 ----------

async function save(saveAs = false) {
  const data = JSON.stringify(state, null, 2)
  if (window.api) {
    await window.api.saveJSON(data, saveAs)
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
  applyLoaded(text)
}

// 파일 내용(JSON 텍스트)을 현재 도면으로 적용
function applyLoaded(text) {
  if (!text) return
  try {
    const s = JSON.parse(text)
    if (!Array.isArray(s.boxes)) throw new Error('bad file')
    pushUndo()
    state = s
    clearSelection()
    arrowMode = false
    arrowSource = null
    render()
  } catch {
    alert('파일을 읽을 수 없습니다.')
  }
}

// 파일을 더블클릭해 실행한 경우: 메인 프로세스가 내용을 보내준다
if (window.api && window.api.onOpenFile) window.api.onOpenFile(applyLoaded)

function renderPNGDataURL(scale) {
  return new Promise((resolve, reject) => {
    const prevSel = selection, prevMulti = multi, prevSrc = arrowSource
    clearSelection()
    arrowSource = null
    render()
    const bb = svg.getBBox()
    const inner = svg.innerHTML
    selection = prevSel
    multi = prevMulti
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

// ---------- 확대 / 축소 (Ctrl + 휠) ----------

// 커서 아래의 도면 지점이 제자리에 머물도록 스크롤을 보정하며 배율 변경
function setZoom(z, clientX, clientY) {
  const sc = $('scroll')
  z = clamp(Math.round(z * 100) / 100, ZOOM_MIN, ZOOM_MAX)
  if (z === zoom) return
  const r = sc.getBoundingClientRect()
  // 커서 위치를 기준으로 삼되, 좌표가 없으면 보이는 영역의 중앙을 기준으로
  const vx = clientX == null ? r.width / 2 : clientX - r.left
  const vy = clientY == null ? r.height / 2 : clientY - r.top
  const cx = (sc.scrollLeft + vx) / zoom     // 커서 아래의 캔버스 좌표
  const cy = (sc.scrollTop + vy) / zoom

  zoom = z
  wrap.style.zoom = z
  $('zoom-label').textContent = Math.round(z * 100) + '%'

  sc.scrollLeft = cx * z - vx
  sc.scrollTop = cy * z - vy
}

$('scroll').addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY)
}, { passive: false })

// ---------- 키보드 / 버튼 배선 ----------

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection() }
  else if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo() }
  else if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAll() }
  else if ((e.metaKey || e.ctrlKey) && e.key === 'c') { e.preventDefault(); copySelection() }
  else if ((e.metaKey || e.ctrlKey) && e.key === 'v') { e.preventDefault(); pasteClipboard() }
  else if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(e.shiftKey) }
  else if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); setZoom(1) }
  else if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(zoom * 1.1) }
  else if ((e.metaKey || e.ctrlKey) && e.key === '-') { e.preventDefault(); setZoom(zoom / 1.1) }
  else if ((e.metaKey || e.ctrlKey) && e.key === ']') { e.preventDefault(); reorderSelection('front') }
  else if ((e.metaKey || e.ctrlKey) && e.key === '[') { e.preventDefault(); reorderSelection('back') }
  else if (e.key === 'Escape') { arrowMode = false; arrowSource = null; clearSelection(); render() }
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
$('btn-text').onclick = () => addBox('text')
$('btn-arrow').onclick = () => { arrowMode = !arrowMode; arrowSource = null; render() }
$('btn-tag').onclick = addTag
$('btn-style').onclick = toggleStyle
$('btn-dash').onclick = toggleDash
$('btn-frame').onclick = toggleFrame
$('btn-ep-reset').onclick = resetEndpoints
$('btn-fs-down').onclick = () => changeFontSize(-1)
$('btn-fs-up').onclick = () => changeFontSize(1)
$('btn-fs-reset').onclick = resetFontSize
$('btn-front').onclick = () => reorderSelection('front')
$('btn-back').onclick = () => reorderSelection('back')
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
