<template>
  <div class="flowchart">
    <div class="flowchart-header">
      <h3 class="section-title">🔗 产线流程图</h3>
      <div class="flowchart-controls">
        <button class="btn btn-secondary btn-sm" @click="zoomIn">🔍+</button>
        <button class="btn btn-secondary btn-sm" @click="zoomOut">🔍-</button>
        <button class="btn btn-secondary btn-sm" @click="resetView">重置</button>
      </div>
    </div>

    <div class="canvas-wrapper" ref="wrapperRef">
      <svg
        ref="svgRef"
        class="flowchart-canvas"
        :viewBox="viewBox"
        @mousedown="startPan"
        @mousemove="doPan"
        @mouseup="endPan"
        @mouseleave="endPan"
        @wheel.prevent="doZoom"
      >
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#4fc3f7" />
          </marker>
          <marker id="arrowhead-dispatch" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#ffd54f" />
          </marker>
        </defs>

        <!-- Grid background -->
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(45,63,90,0.3)" stroke-width="0.5"/>
        </pattern>
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Edges (arrows) -->
        <g class="edges">
          <template v-for="edge in edges" :key="edge.key">
            <path
              :d="edge.path"
              fill="none"
              :stroke="edge.isDispatch ? '#ffd54f' : '#4fc3f7'"
              stroke-width="2"
              :marker-end="edge.isDispatch ? 'url(#arrowhead-dispatch)' : 'url(#arrowhead)'"
              :stroke-dasharray="edge.isDispatch ? '5,3' : 'none'"
            />
          </template>
        </g>

        <!-- Nodes -->
        <g class="nodes">
          <template v-for="node in nodes" :key="node.id">
            <g
              class="node"
              :transform="`translate(${node.x}, ${node.y})`"
              :class="{ 'node-raw': node.isRaw, 'node-final': node.isFinal, 'node-dispatch': node.hasDispatch }"
              @click="selectNode(node)"
              @dblclick="highlightPath(node)"
            >
              <!-- Node background -->
              <rect
                :x="-node.width/2"
                :y="-node.height/2"
                :width="node.width"
                :height="node.height"
                :rx="6"
                :class="['node-bg', { selected: selectedNode?.id === node.id, highlighted: highlightedNodes.has(node.id) }]"
              />

              <!-- Icon -->
              <circle :cx="-node.width/2 + 16" :cy="0" r="8" :fill="node.color" opacity="0.8"/>

              <!-- Product name -->
              <text x="4" y="-4" class="node-name" text-anchor="start">{{ node.name }}</text>

              <!-- Rate info -->
              <text x="4" y="10" class="node-rate" text-anchor="start">
                {{ node.outputPerMin > 0 ? '↑' + node.outputPerMin.toFixed(1) : '' }}
                {{ node.consumePerMin > 0 ? '↓' + node.consumePerMin.toFixed(1) : '' }}
              </text>

              <!-- Dispatch value badge -->
              <g v-if="node.dispatchVal > 0" :transform="`translate(${node.width/2 - 20}, ${-node.height/2 + 4})`">
                <rect x="0" y="0" width="18" height="14" rx="3" fill="#ffd54f"/>
                <text x="9" y="10" class="node-dispatch-badge" text-anchor="middle">{{ node.dispatchVal }}</text>
              </g>
            </g>
          </template>
        </g>
      </svg>
    </div>

    <!-- Node detail panel -->
    <div v-if="selectedNode" class="node-detail">
      <div class="detail-header">
        <h4>{{ selectedNode.name }}</h4>
        <button class="btn-icon" @click="selectedNode = null">✕</button>
      </div>
      <div class="detail-body">
        <div class="detail-row">
          <span class="detail-label">类型</span>
          <span class="detail-value">
            {{ selectedNode.isRaw ? '🌍 原始原料' : selectedNode.isFinal ? '📤 最终产品' : '⚙️ 中间产物' }}
          </span>
        </div>
        <div v-if="selectedNode.outputPerMin > 0" class="detail-row">
          <span class="detail-label">产出/分</span>
          <span class="detail-value val-success">{{ selectedNode.outputPerMin.toFixed(2) }}</span>
        </div>
        <div v-if="selectedNode.consumePerMin > 0" class="detail-row">
          <span class="detail-label">消耗/分</span>
          <span class="detail-value val-danger">{{ selectedNode.consumePerMin.toFixed(2) }}</span>
        </div>
        <div v-if="selectedNode.dispatchVal > 0" class="detail-row">
          <span class="detail-label">调度券/个</span>
          <span class="detail-value val-cell">{{ selectedNode.dispatchVal }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">产出效率</span>
          <span class="detail-value">{{ ((selectedNode.efficiency || 1) * 100).toFixed(0) }}%</span>
        </div>
        <div v-if="selectedNode.recipeLines.length > 0" class="detail-row">
          <span class="detail-label">配方</span>
        </div>
        <div v-for="line in selectedNode.recipeLines" :key="line.recipeId" class="detail-recipe">
          <span>{{ line.machine }} ×{{ line.count?.toFixed(1) || 1 }}</span>
          <span class="val-cell">{{ line.dispatchPerMin?.toFixed(1) || '-' }} 券/分</span>
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="flowchart-legend">
      <div class="legend-item"><span class="legend-dot" style="background:#4fc3f7"></span>生产流</div>
      <div class="legend-item"><span class="legend-dot" style="background:#ffd54f"></span>调度券产出</div>
      <div class="legend-item"><span class="legend-dot" style="background:#81c784"></span>最终产品</div>
      <div class="legend-item"><span class="legend-dot" style="background:#78909c"></span>原始原料</div>
      <div class="legend-item"><span class="legend-dot" style="background:#ce93d8"></span>中间产物</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { getAllRecipesWithInputs } from '../db.js'
import { DISPATCH_VALUE, MACHINE_POWER, RECIPE_MAP, RECIPES } from '../data/recipes.js'

const props = defineProps({
  activeLines: {
    type: Array,
    default: () => []
  },
  results: {
    type: Object,
    default: null
  }
})

const svgRef = ref(null)
const wrapperRef = ref(null)
const selectedNode = ref(null)
const highlightedNodes = ref(new Set())

const PANEL_WIDTH = 900
const PANEL_HEIGHT = 500
const NODE_W = 140
const NODE_H = 48
const H_GAP = 180
const V_GAP = 80

// Pan/zoom state
const viewBox = ref(`0 0 ${PANEL_WIDTH} ${PANEL_HEIGHT}`)
const panStart = ref({ x: 0, y: 0, vx: 0, vy: 0 })
const isPanning = ref(false)
const panOffset = ref({ x: 0, y: 0 })
const zoomLevel = ref(1)

// Raw material list from recipes
const RAW_MATERIALS = new Set([
  '紫晶矿', '蓝铁矿', '赤铜矿', '赫铜矿', '源矿',
  '清水', '污水', '沉积酸', '驮兽粪便',
  '灰芦麦', '苦叶椒', '琼叶参', '金石稻',
])

// Machine categories
const MACHINE_COLORS = {
  '灌装机': '#FFF2CC',
  '精炼炉': '#FCE4D6',
  '封装机': '#E2EFDA',
  '粉碎机': '#DEEAF1',
  '采种机': '#E2EFDA',
  '反应池': '#FFE0CC',
  '扩容反应池': '#F4B084',
  '配件机': '#D9E2F3',
  '塑形机': '#D9E2F3',
  '研磨机': '#D9E2F3',
  '种植机': '#E2EFDA',
  '装备原件机': '#E2EFDA',
  '天有洪炉': '#FCE4D6',
  '提纯机': '#FCE4D6',
  '采集设备': '#CFD8DC',
}

const nodes = computed(() => {
  if (!props.results?.lineDetails || props.results.lineDetails.length === 0) {
    return buildEmptyNodes()
  }

  const lines = props.results.lineDetails
  const resultNodes = []
  const productSet = new Set()

  // Collect all products from active lines
  for (const line of lines) {
    productSet.add(line.product)
  }

  // Group lines by product
  const linesByProduct = {}
  for (const line of lines) {
    if (!linesByProduct[line.product]) linesByProduct[line.product] = []
    linesByProduct[line.product].push(line)
  }

  // Assign levels based on graph distance from raw materials
  const levels = {}
  const visited = new Set()
  const nodeProducts = new Set(Object.keys(linesByProduct))

  // Compute levels
  function assignLevel(product, level) {
    if (levels[product] !== undefined && levels[product] >= level) return
    levels[product] = level

    // Find consumers of this product
    for (const line of lines) {
      if (line.consume && line.consume[product]) {
        assignLevel(line.product, level + 1)
      }
    }
  }

  // Start from products with no inputs (raw or early stage)
  for (const prod of nodeProducts) {
    const line = linesByProduct[prod][0]
    if (!line.consume || Object.keys(line.consume).length === 0) {
      assignLevel(prod, 0)
    }
  }

  for (const prod of nodeProducts) {
    if (levels[prod] === undefined) levels[prod] = 1
  }

  // Group by level
  const byLevel = {}
  for (const [prod, lvl] of Object.entries(levels)) {
    if (!byLevel[lvl]) byLevel[lvl] = []
    byLevel[lvl].push(prod)
  }

  const maxLevel = Math.max(...Object.keys(byLevel).map(Number), 0)

  // Position nodes
  let yOffset = 60
  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const products = byLevel[lvl] || []
    const xStart = (PANEL_WIDTH - (products.length - 1) * H_GAP) / 2

    for (let i = 0; i < products.length; i++) {
      const prod = products[i]
      const lines = linesByProduct[prod]
      const line = lines[0]

      const totalOutput = lines.reduce((sum, l) => sum + (l.actualOutput || 0), 0)
      const totalConsume = (line.consume ? Object.values(line.consume).reduce((s, v) => s + v, 0) : 0) || 0

      resultNodes.push({
        id: prod,
        name: prod,
        x: xStart + i * H_GAP,
        y: yOffset,
        width: NODE_W,
        height: NODE_H,
        isRaw: RAW_MATERIALS.has(prod),
        isFinal: !lines.some(l => l.consume && l.consume[prod]),
        hasDispatch: DISPATCH_VALUE[prod] > 0,
        dispatchVal: DISPATCH_VALUE[prod] || 0,
        outputPerMin: totalOutput,
        consumePerMin: totalConsume,
        efficiency: line.efficiency || 1,
        recipeLines: lines,
        color: MACHINE_COLORS[line.machine] || '#E2EFDA',
      })
    }

    yOffset += NODE_H + V_GAP
  }

  return resultNodes
})

const edges = computed(() => {
  if (!props.results?.lineDetails || props.results.lineDetails.length === 0) return []

  const resultEdges = []
  const lines = props.results.lineDetails

  for (const line of lines) {
    if (!line.consume) continue

    for (const [ing, amount] of Object.entries(line.consume)) {
      // Find producer of this ingredient
      const producer = lines.find(l => l.product === ing)
      if (!producer) continue

      const sourceNode = nodes.value.find(n => n.id === ing)
      const targetNode = nodes.value.find(n => n.id === line.product)

      if (!sourceNode || !targetNode) continue

      // Determine if this is a dispatch edge (producer output goes to final dispatch)
      const isDispatch = DISPATCH_VALUE[line.product] > 0 &&
                        !lines.some(l => l.consume && l.consume[line.product])

      // Bezier curve from source to target
      const sx = sourceNode.x + sourceNode.width / 2
      const sy = sourceNode.y
      const tx = targetNode.x + targetNode.width / 2
      const ty = targetNode.y + targetNode.height

      const midY = (sy + ty) / 2
      const path = `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`

      resultEdges.push({
        key: `${ing}->${line.product}`,
        path,
        isDispatch,
      })
    }
  }

  return resultEdges
})

function buildEmptyNodes() {
  return []
}

function selectNode(node) {
  selectedNode.value = selectedNode.value?.id === node.id ? null : node
}

function highlightPath(node) {
  if (!node) return
  const newSet = new Set([node.id])
  // Find connected nodes
  for (const edge of edges.value) {
    if (edge.path.includes(node.id)) {
      const parts = edge.key.split('->')
      parts.forEach(p => newSet.add(p))
    }
  }
  highlightedNodes.value = newSet
}

function zoomIn() {
  zoomLevel.value = Math.min(2, zoomLevel.value * 1.2)
  applyViewBox()
}

function zoomOut() {
  zoomLevel.value = Math.max(0.5, zoomLevel.value / 1.2)
  applyViewBox()
}

function resetView() {
  zoomLevel.value = 1
  panOffset.value = { x: 0, y: 0 }
  applyViewBox()
}

function applyViewBox() {
  const w = PANEL_WIDTH / zoomLevel.value
  const h = PANEL_HEIGHT / zoomLevel.value
  const x = -panOffset.value.x
  const y = -panOffset.value.y
  viewBox.value = `${x} ${y} ${w} ${h}`
}

function startPan(e) {
  isPanning.value = true
  const pt = getSVGPoint(e)
  panStart.value = { x: pt.x, y: pt.y, ox: panOffset.value.x, oy: panOffset.value.y }
}

function doPan(e) {
  if (!isPanning.value) return
  const pt = getSVGPoint(e)
  panOffset.value = {
    x: panStart.value.ox + (pt.x - panStart.value.x),
    y: panStart.value.oy + (pt.y - panStart.value.y)
  }
  applyViewBox()
}

function endPan() {
  isPanning.value = false
}

function doZoom(e) {
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  zoomLevel.value = Math.max(0.5, Math.min(3, zoomLevel.value * delta))
  applyViewBox()
}

function getSVGPoint(e) {
  const svg = svgRef.value
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  return pt.matrixTransform(svg.getScreenCTM().inverse())
}
</script>

<style scoped>
.flowchart {
  background: var(--surface2);
  border-radius: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  margin-bottom: 12px;
}

.flowchart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.flowchart-controls {
  display: flex;
  gap: 4px;
}

.btn-sm {
  padding: 3px 8px;
  font-size: 11px;
}

.canvas-wrapper {
  background: var(--bg);
  border-radius: 8px;
  overflow: hidden;
  height: 400px;
  border: 1px solid var(--border);
}

.flowchart-canvas {
  width: 100%;
  height: 100%;
  cursor: grab;
}

.flowchart-canvas:active {
  cursor: grabbing;
}

.node {
  cursor: pointer;
  transition: transform 0.15s;
}

.node:hover {
  transform: scale(1.05);
}

.node-bg {
  fill: var(--surface2);
  stroke: var(--border);
  stroke-width: 2;
  transition: all 0.15s;
}

.node-bg.selected {
  stroke: var(--accent);
  stroke-width: 3;
}

.node-bg.highlighted {
  stroke: var(--gold);
  stroke-width: 3;
  fill: rgba(255, 213, 79, 0.1);
}

.node-name {
  font-size: 12px;
  fill: var(--text);
  font-weight: 600;
  dominant-baseline: middle;
}

.node-rate {
  font-size: 10px;
  fill: var(--text2);
  dominant-baseline: middle;
}

.node-dispatch-badge {
  font-size: 9px;
  fill: #333;
  font-weight: 700;
}

.node-detail {
  position: absolute;
  right: 14px;
  top: 70px;
  width: 200px;
  background: var(--surface2);
  border-radius: 8px;
  border: 1px solid var(--border);
  padding: 10px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}

.detail-header h4 {
  font-size: 13px;
  color: var(--accent);
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.detail-label {
  color: var(--text2);
}

.detail-value {
  color: var(--text);
  font-weight: 600;
}

.detail-recipe {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text2);
  padding-left: 8px;
  margin-top: 2px;
}

.flowchart-legend {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text2);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.val-success { color: var(--accent2); }
.val-danger { color: var(--danger); }
.val-cell { color: var(--gold); font-weight: 600; }
</style>