<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <div class="header-content">
        <div class="header-left">
          <h1>🎮 明日方舟：终末地</h1>
          <h2>产量计算器</h2>
        </div>
        <!-- Navigation -->
        <nav class="nav">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="nav-btn"
            :class="{ active: currentTab === tab.id }"
            @click="currentTab = tab.id"
          >
            {{ tab.icon }} {{ tab.label }}
          </button>
        </nav>
      </div>
    </header>

    <main class="main">
      <!-- Tab: 计算器 -->
      <div v-if="currentTab === 'calc'" class="tab-content">
        <!-- Left Panel: Configuration -->
        <aside class="panel panel-left">
          <!-- Presets -->
          <section class="section">
            <h3 class="section-title">📋 预设模板</h3>
            <div class="preset-grid">
              <button
                v-for="(preset, key) in PRESETS"
                :key="key"
                class="preset-btn"
                :class="{ active: currentPreset === key }"
                @click="loadPreset(key)"
              >
                {{ preset.desc.split('（')[0] }}
                <span class="preset-sub">{{ key }}</span>
              </button>
            </div>
          </section>

          <!-- Production Lines -->
          <section class="section">
            <h3 class="section-title">🏭 产线配置</h3>
            <div class="add-line-form">
              <select v-model="newLineRecipe" class="select" @change="onRecipeSelect">
                <option value="">选择配方...</option>
                <optgroup v-for="cat in categories" :key="cat" :label="cat">
                  <option v-for="r in recipesByCategory[cat]" :key="r.id" :value="r.id">
                    {{ r.name }} ({{ r.product }})
                  </option>
                </optgroup>
              </select>
              <select v-if="showVariantSelect" v-model="selectedVariantId" class="select variant-select">
                <option value="">-- 选择配方变体 --</option>
                <option v-for="v in currentProductVariants" :key="v.id" :value="v.id">
                  {{ v.machine }} - {{ v.name }} ({{ v.productPerMin }}/min)
                </option>
              </select>
              <input v-model.number="newLineCount" type="number" min="1" max="99" class="input count-input" placeholder="数量" />
              <input v-model.number="newLineEff" type="number" min="0" max="1" step="0.1" class="input eff-input" placeholder="效率" />
              <button class="btn btn-primary" @click="addLine" :disabled="!newLineRecipe">添加</button>
            </div>

            <div class="line-list-header">
              <span class="line-list-title">已添加产线 ({{ activeLines.length }})</span>
              <button v-if="activeLines.length > 0" class="btn btn-clear" @click="clearAllLines">🗑 清空</button>
            </div>

            <div class="line-list">
              <div v-for="(line, idx) in activeLines" :key="idx" class="line-item">
                <span class="line-name">{{ line.recipe.name }}</span>
                <select
                  v-if="PRODUCT_VARIANTS[line.recipe.product]?.length > 1"
                  class="select variant-select"
                  :value="line.recipe.id"
                  @change="changeVariant(idx, $event.target.value)"
                >
                  <option v-for="v in PRODUCT_VARIANTS[line.recipe.product]" :key="v.id" :value="v.id">
                    {{ v.machine }} - {{ v.name }} ({{ v.productPerMin }}/min)
                  </option>
                </select>
                <span class="line-meta">
                  {{ line.recipe.machine }} ×{{ line.count }} | {{ (line.efficiency * 100).toFixed(0) }}% | ⚡{{ line.powerKw }}kW
                </span>
                <button class="btn-icon" @click="removeLine(idx)" title="删除">✕</button>
              </div>
              <div v-if="activeLines.length === 0" class="empty-state">
                点击上方按钮添加产线，或加载预设模板
              </div>
            </div>
          </section>

          <!-- Power -->
          <section class="section">
            <h3 class="section-title">⚡ 发电配置</h3>
            <div class="power-grid">
              <div v-for="(info, src) in POWER_GEN" :key="src" class="power-item">
                <label class="power-label">
                  <input v-model.number="selectedPower[src]" type="number" min="0" max="99" class="input power-count-input" @change="syncPower" />
                  {{ src }}
                  <span class="power-val">{{ info.power }}kW × {{ selectedPower[src] || 0 }}</span>
                </label>
              </div>
            </div>
            <div class="power-summary" v-if="totalGen > 0">
              总发电: <strong>{{ totalGen }}kW</strong>
            </div>
          </section>

          <!-- Raw Limits -->
          <section class="section">
            <h3 class="section-title">📌 原料上限（可选）</h3>
            <div class="limits-grid">
              <div v-for="(val, res) in rawLimits" :key="res" class="limit-item">
                <span>{{ res }}</span>
                <input v-model.number="rawLimits[res]" type="number" min="0" class="input limit-input" />
                <button class="btn-icon sm" @click="delete rawLimits[res]">✕</button>
              </div>
            </div>
            <div class="add-limit-form">
              <select v-model="newLimitRes" class="select">
                <option value="">选择原料...</option>
                <option v-for="r in rawResources" :key="r" :value="r">{{ r }}</option>
              </select>
              <input v-model.number="newLimitVal" type="number" min="0" class="input limit-input" placeholder="上限/分" />
              <button class="btn btn-secondary" @click="addLimit" :disabled="!newLimitRes">设置</button>
            </div>
          </section>

          <button class="btn btn-calculate" @click="calculate" :disabled="activeLines.length === 0">
            🔄 计算产量
          </button>
        </aside>

        <!-- Right Panel: Results -->
        <section class="panel panel-right">
          <div v-if="!results" class="no-results">
            <p>👈 左侧添加产线后，点击「计算产量」查看结果</p>
          </div>

          <div v-else class="results">
            <!-- Summary Cards -->
            <div class="result-cards">
              <div class="result-card card-dispatch">
                <div class="card-label">🎫 调度券产出</div>
                <div class="card-value">{{ formatNum(results.dispatchPerMin) }}/分</div>
                <div class="card-sub">{{ formatNum(results.dispatchPerHour) }}/时 · {{ formatNum(results.dispatchPerDay) }}/天</div>
              </div>
              <div class="result-card" :class="results.powerConsume > results.powerGen ? 'card-danger' : 'card-success'">
                <div class="card-label">⚡ 电力消耗/分</div>
                <div class="card-value">
                  {{ results.powerConsume.toFixed(0) }} / {{ results.powerGen.toFixed(0) }} kW
                </div>
                <div class="card-sub">
                  {{ results.powerGen >= results.powerConsume ? '盈余' : '欠缺' }}
                  {{ Math.abs(results.powerGen - results.powerConsume).toFixed(0) }}kW
                </div>
              </div>
            </div>

            <!-- Warnings -->
            <div v-for="(w, i) in results.warnings" :key="i" class="alert" :class="'alert-' + w.type">
              {{ w.text }}
            </div>

            <!-- 最终产品 -->
            <div class="result-section" v-if="Object.keys(results.finalProducts).length > 0">
              <h3 class="section-title">🏭 最终产品</h3>
              <table class="result-table">
                <thead>
                  <tr>
                    <th>产品</th>
                    <th>产量/分</th>
                    <th>调度券/分</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(amount, prod) in results.finalProducts" :key="prod">
                    <td>{{ prod }}</td>
                    <td>{{ amount.toFixed(2) }}</td>
                    <td class="val-cell">{{ formatNum(amount * (DISPATCH_VALUE[prod] || 0)) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 中间产物明细 -->
            <div class="result-section" v-if="Object.keys(results.intermediateProducts).length > 0">
              <h3 class="section-title">📦 中间产物</h3>
              <table class="result-table">
                <thead>
                  <tr>
                    <th>产物</th>
                    <th>产出/分</th>
                    <th>下游消耗</th>
                    <th>余量</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(vals, prod) in results.intermediateProducts" :key="prod">
                    <td>{{ prod }}</td>
                    <td>{{ vals.产出.toFixed(2) }}</td>
                    <td>{{ vals.消耗.toFixed(2) }}</td>
                    <td :class="vals.余量 < -0.001 ? 'val-danger' : vals.余量 > 0.001 ? 'val-success' : ''">
                      {{ vals.余量 >= 0 ? '+' : '' }}{{ vals.余量.toFixed(2) }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p class="table-note">余量 > 0 表示有结余，&lt; 0 表示原料不足</p>
            </div>

            <!-- 原料消耗（仅矿石和水）-->
            <div class="result-section" v-if="Object.keys(results.rawConsume).length > 0">
              <h3 class="section-title">🪨 原料消耗 (/分钟)</h3>
              <table class="result-table">
                <thead>
                  <tr>
                    <th>原料</th>
                    <th>消耗/分</th>
                    <th>上限</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(amount, res) in results.rawConsume" :key="res">
                    <td>{{ res }}</td>
                    <td>{{ amount.toFixed(2) }}</td>
                    <td>{{ rawLimits[res] !== undefined ? rawLimits[res].toFixed(2) : '∞' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 产线详情 -->
            <div class="result-section">
              <h3 class="section-title">🔩 产线详情</h3>
              <table class="result-table">
                <thead>
                  <tr>
                    <th>配方</th>
                    <th>设备</th>
                    <th>数量</th>
                    <th>效率</th>
                    <th>产出/分</th>
                    <th>电力kW</th>
                    <th>调度券/分</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="lr in results.lineDetails" :key="lr.lineIndex">
                    <td>{{ lr.recipeName }}</td>
                    <td>{{ lr.machine }}</td>
                    <td>×{{ lr.count }}</td>
                    <td :class="lr.efficiency < 0.99 ? 'val-warning' : ''">{{ (lr.efficiency * 100).toFixed(0) }}%</td>
                    <td>{{ lr.actualOutput.toFixed(2) }}</td>
                    <td>{{ lr.powerKw.toFixed(0) }}</td>
                    <td class="val-cell">{{ formatNum(lr.dispatchValue) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <!-- Tab: 配方查看 -->
      <div v-if="currentTab === 'recipes'" class="tab-content tab-recipes">
        <RecipeBrowser />
      </div>

      <!-- Tab: 调度券 -->
      <div v-if="currentTab === 'dispatch'" class="tab-content tab-dispatch">
        <section class="panel-center">
          <h3 class="page-title">💰 调度券兑换表</h3>
          <p class="page-subtitle">1物资 = X 调度券（来源：游戏内调度券兑换）</p>
          <table class="result-table">
            <thead>
              <tr>
                <th>#</th>
                <th>产品</th>
                <th>1个 = 调度券</th>
                <th>每小时</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(dv, idx) in sortedDispatchList" :key="idx">
                <td class="idx-cell">{{ idx + 1 }}</td>
                <td>{{ dv.prod }}</td>
                <td class="val-cell">{{ dv.val }}</td>
                <td>{{ formatNum(dv.val * 60) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </main>

    <footer class="footer">
      数据来源：end.wiki | 设备电力数据：灌装机20kW/精炼炉5kW/封装机20kW/粉碎机20kW/采种机5kW/反应池15kW/配件机20kW/塑形机20kW/研磨机20kW/种植机5kW/装备原件机20kW/天有洪炉25kW/提纯机15kW/扩容反应池30kW
    </footer>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { RECIPES, PRESETS, DISPATCH_VALUE, POWER_GEN, PRODUCT_VARIANTS, RECIPE_MAP } from './data/recipes.js'
import { calculate as calcEngine, createLine, autoExpandUpstream } from './CalculatorEngine.js'
import RecipeBrowser from './components/RecipeBrowser.vue'

// Navigation
const tabs = [
  { id: 'calc', label: '计算器', icon: '🧮' },
  { id: 'recipes', label: '配方查看', icon: '📖' },
  { id: 'dispatch', label: '调度券', icon: '🎫' },
]
const currentTab = ref('calc')

// Recipe categories
const categories = [...new Set(RECIPES.map(r => r.category))].filter(Boolean).sort()
const recipesByCategory = {}
for (const cat of categories) {
  recipesByCategory[cat] = RECIPES.filter(r => r.category === cat)
}
const allProducts = [...new Set(RECIPES.map(r => r.product))]
const rawResources = allProducts

// State
const activeLines = ref([])
const selectedPower = reactive({})
const rawLimits = reactive({})
const results = ref(null)
const currentPreset = ref('')

// Form state
const newLineRecipe = ref('')
const newLineCount = ref(1)
const newLineEff = ref(1.0)
const newLimitRes = ref('')
const newLimitVal = ref(10)

// Recipe variant selection state
const selectedVariantId = ref('')

const selectedRecipeObj = computed(() => {
  if (!newLineRecipe.value) return null
  return RECIPES.find(r => r.id === newLineRecipe.value)
})

const currentProductVariants = computed(() => {
  if (!selectedRecipeObj.value) return []
  return PRODUCT_VARIANTS[selectedRecipeObj.value.product] || []
})

const showVariantSelect = computed(() => {
  return currentProductVariants.value.length > 1
})

// Dispatch table as list for tab view
const sortedDispatchList = computed(() => {
  return Object.entries(DISPATCH_VALUE)
    .sort((a, b) => b[1] - a[1])
    .map(([prod, val]) => ({ prod, val }))
})

function onRecipeSelect() {
  selectedVariantId.value = ''
}

// Computed
const totalGen = computed(() => {
  let total = 0
  for (const [src, count] of Object.entries(selectedPower)) {
    if (count > 0) total += (POWER_GEN[src]?.power || 0) * count
  }
  return total
})

const totalPowerKw = computed(() => {
  if (!results.value?.machineDetails) return 0
  return Object.values(results.value.machineDetails).reduce((sum, m) => sum + m.powerKw, 0)
})

// Methods
function addLine() {
  if (!newLineRecipe.value) return
  const recipeId = selectedVariantId.value || newLineRecipe.value
  const line = createLine(recipeId, newLineCount.value || 1, newLineEff.value || 1.0)
  if (line) {
    activeLines.value.push(line)
    results.value = null
  }
  newLineRecipe.value = ''
  newLineCount.value = 1
  newLineEff.value = 1.0
  selectedVariantId.value = ''
}

function removeLine(idx) {
  activeLines.value.splice(idx, 1)
  results.value = null
}

function clearAllLines() {
  activeLines.value.splice(0, activeLines.value.length)
  results.value = null
}

function changeVariant(lineIndex, newRecipeId) {
  const recipeObj = RECIPE_MAP[newRecipeId]
  if (recipeObj && activeLines.value[lineIndex]) {
    activeLines.value[lineIndex].recipe = recipeObj
    activeLines.value[lineIndex].efficiency = 1.0
    recalculate()
  }
}

function recalculate() {
  if (activeLines.value.length === 0) return
  const powerSources = {}
  for (const [src, count] of Object.entries(selectedPower)) {
    if (count > 0) powerSources[src] = count
  }
  let linesToCalc = activeLines.value
  try {
    const expandedLines = autoExpandUpstream(activeLines.value)
    linesToCalc = expandedLines
  } catch (e) {
    console.error('autoExpandUpstream error:', e)
  }
  results.value = calcEngine(linesToCalc, powerSources, rawLimits)
}

function syncPower() {}

function addLimit() {
  if (!newLimitRes.value) return
  rawLimits[newLimitRes.value] = newLimitVal.value || 0
  newLimitRes.value = ''
  newLimitVal.value = 10
  results.value = null
}

function loadPreset(key) {
  const preset = PRESETS[key]
  if (!preset) return

  activeLines.value = []
  for (const k of Object.keys(selectedPower)) {
    selectedPower[k] = 0
  }

  for (const spec of preset.lines) {
    const line = createLine(spec.recipeId, spec.count, spec.efficiency)
    if (line) activeLines.value.push(line)
  }

  for (const [src, cnt] of Object.entries(preset.power)) {
    if (selectedPower[src] !== undefined) {
      selectedPower[src] = cnt
    }
  }

  for (const k of Object.keys(rawLimits)) {
    delete rawLimits[k]
  }

  currentPreset.value = key
  results.value = null
}

function calculate() {
  if (activeLines.value.length === 0) return

  const powerSources = {}
  for (const [src, count] of Object.entries(selectedPower)) {
    if (count > 0) powerSources[src] = count
  }

  let linesToCalc = activeLines.value
  try {
    const expandedLines = autoExpandUpstream(activeLines.value)
    linesToCalc = expandedLines
  } catch (e) {
    console.error('autoExpandUpstream error:', e)
  }

  results.value = calcEngine(linesToCalc, powerSources, rawLimits)
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toFixed(0)
}
</script>

<style>
/* Reset & Base */
* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0f1419;
  --surface: #1a2332;
  --surface2: #243044;
  --border: #2d3f5a;
  --accent: #4fc3f7;
  --accent2: #81c784;
  --danger: #ef5350;
  --warning: #ffb74d;
  --text: #e8eef4;
  --text2: #8ba3be;
  --gold: #ffd54f;
  --purple: #ce93d8;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  min-height: 100vh;
  font-size: 14px;
}

.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* Header */
.header {
  background: linear-gradient(135deg, #1a2a3a 0%, #0d1f30 100%);
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
}
.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 60px;
}
.header-left h1 { font-size: 20px; font-weight: 700; color: var(--accent); }
.header-left h2 { font-size: 13px; color: var(--text2); font-weight: 400; margin-top: 1px; }

/* Navigation */
.nav {
  display: flex;
  gap: 4px;
}
.nav-btn {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 16px;
  color: var(--text2);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.nav-btn:hover {
  border-color: var(--border);
  color: var(--text);
}
.nav-btn.active {
  background: rgba(79, 195, 247, 0.12);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

/* Main Layout */
.main {
  flex: 1;
  overflow-x: hidden;
  overflow-y: visible;
  min-height: 0;
}

.tab-content {
  flex: 1;
  overflow-x: hidden;
  overflow-y: visible;
  display: flex;
  min-height: 0;
}

/* Panels */
.panel {
  padding: 16px;
  overflow-y: auto;
}
.panel-left {
  width: 420px;
  min-width: 360px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.panel-right {
  flex: 1;
  background: var(--bg);
}
.panel-center {
  flex: 1;
  background: var(--bg);
  padding: 24px;
  overflow-y: auto;
}

/* Page titles for tab pages */
.page-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 6px;
}
.page-subtitle {
  font-size: 12px;
  color: var(--text2);
  margin-bottom: 16px;
}
.idx-cell { color: var(--text2); font-size: 11px; width: 30px; }

/* Sections */
.section {
  background: var(--surface2);
  border-radius: 10px;
  padding: 12px;
  border: 1px solid var(--border);
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}

/* Preset Grid */
.preset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.preset-btn {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 6px;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
  line-height: 1.3;
}
.preset-btn:hover { border-color: var(--accent); color: var(--accent); }
.preset-btn.active { border-color: var(--accent); background: rgba(79, 195, 247, 0.1); }
.preset-sub { display: block; font-size: 10px; color: var(--text2); margin-top: 2px; }

/* Add Line Form */
.add-line-form {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.select, .input {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 5px 8px;
  font-size: 12px;
}
.select { flex: 2; min-width: 0; }
.input.count-input { width: 44px; flex: none; text-align: center; }
.input.eff-input { width: 44px; flex: none; text-align: center; }
.select:focus, .input:focus { outline: none; border-color: var(--accent); }

/* Buttons */
.btn {
  border: none;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  font-weight: 600;
}
.btn-primary { background: var(--accent); color: #000; }
.btn-primary:hover { background: #81d4fa; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-secondary { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
.btn-secondary:hover { border-color: var(--accent); }
.btn-calculate {
  width: 100%;
  background: linear-gradient(135deg, var(--accent), #29b6f6);
  color: #000;
  font-size: 15px;
  font-weight: 700;
  padding: 12px;
  border-radius: 10px;
}
.btn-calculate:hover { filter: brightness(1.1); }
.btn-calculate:disabled { opacity: 0.4; cursor: not-allowed; filter: none; }
.btn-icon {
  background: none;
  border: none;
  color: var(--text2);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
}
.btn-icon:hover { color: var(--danger); background: rgba(239, 83, 80, 0.1); }
.btn-icon.sm { font-size: 10px; padding: 1px 4px; }
.btn-clear {
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.btn-clear:hover { background: rgba(239, 83, 80, 0.12); }

/* Line List */
.line-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.line-list-title { font-size: 11px; color: var(--text2); }
.line-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
}
.line-item {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--surface);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
}
.line-name { flex: 1; color: var(--text); }
.line-meta { color: var(--text2); font-size: 11px; white-space: nowrap; }
.empty-state { color: var(--text2); font-size: 12px; text-align: center; padding: 12px; }

/* Power */
.power-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.power-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
}
.power-label input { accent-color: var(--accent); }
.power-count-input { width: 40px; padding: 2px 4px; font-size: 11px; text-align: center; }
.power-val { color: var(--accent2); margin-left: auto; font-size: 11px; }
.power-summary { margin-top: 8px; font-size: 12px; color: var(--accent2); text-align: right; }

/* Limits */
.limits-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}
.limit-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.limit-item span { flex: 1; color: var(--text2); font-size: 11px; }
.limit-item .input { width: 60px; padding: 3px 6px; font-size: 11px; }
.add-limit-form { display: flex; gap: 4px; align-items: center; }
.add-limit-form .select { flex: 1; font-size: 11px; padding: 4px 6px; }
.add-limit-form .input { width: 50px; font-size: 11px; padding: 4px; }

/* Results */
.no-results {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text2);
  font-size: 14px;
}
.results { padding: 0; }

.result-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}
.result-card {
  background: var(--surface);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid var(--border);
  text-align: center;
}
.card-dispatch { border-color: var(--gold); background: rgba(255, 213, 79, 0.05); }
.card-dispatch .card-label { color: var(--gold); }
.card-dispatch .card-value { font-size: 24px; font-weight: 700; color: var(--gold); margin: 4px 0; }
.card-dispatch .card-sub { font-size: 11px; color: var(--text2); }
.card-success { border-color: var(--accent2); }
.card-success .card-label { color: var(--accent2); }
.card-success .card-value { font-size: 18px; font-weight: 700; color: var(--accent2); }
.card-danger { border-color: var(--danger); }
.card-danger .card-label { color: var(--danger); }
.card-danger .card-value { font-size: 18px; font-weight: 700; color: var(--danger); }
.card-sub { font-size: 11px; color: var(--text2); }

.alert {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 12px;
}
.alert-danger { background: rgba(239, 83, 80, 0.12); border: 1px solid var(--danger); color: var(--danger); }
.alert-success { background: rgba(129, 199, 132, 0.12); border: 1px solid var(--accent2); color: var(--accent2); }

/* Result Sections */
.result-section {
  background: var(--surface);
  border-radius: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  margin-bottom: 12px;
}
.result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.result-table th {
  text-align: left;
  color: var(--text2);
  font-weight: 500;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}
.result-table td {
  padding: 5px 8px;
  border-bottom: 1px solid rgba(45, 63, 90, 0.5);
}
.result-table tr:last-child td { border-bottom: none; }
.val-cell { color: var(--gold); font-weight: 600; }
.val-danger { color: var(--danger); font-weight: 600; }
.val-success { color: var(--accent2); font-weight: 600; }
.val-warning { color: var(--warning); font-weight: 600; }
.table-note { font-size: 11px; color: var(--text2); margin-top: 6px; padding: 4px 8px; background: var(--surface); border-radius: 4px; display: inline-block; }

/* Footer */
.footer {
  text-align: center;
  padding: 8px 10px;
  font-size: 10px;
  color: var(--text2);
  border-top: 1px solid var(--border);
  background: var(--surface);
  line-height: 1.4;
}

/* Scrollbar */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* Mobile Responsive */
@media (max-width: 768px) {
  /* ---- Layout ---- */
  .tab-content {
    display: flex;
    flex-direction: column;
    overflow: visible !important;
    flex: unset;
    height: auto;
  }
  .tab-content .panel-left,
  .tab-content .panel-right {
    width: 100%;
    min-width: unset;
    height: auto;
    max-height: none;
    border-right: none;
    border-bottom: 1px solid var(--border);
    overflow: visible !important;
    flex: unset;
  }

  /* ---- Header / Nav ---- */
  .header { padding: 0; }
  .header-content {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    min-height: unset;
    padding: 0;
  }
  .header-left {
    padding: 8px 12px;
    flex-shrink: 0;
  }
  .header-left h1 { font-size: 14px; }
  .header-left h2 { display: none; }
  .nav {
    display: flex;
    overflow-x: auto;
    flex-shrink: 0;
    gap: 0;
    scrollbar-width: none;
  }
  .nav::-webkit-scrollbar { display: none; }
  .nav-btn {
    flex-shrink: 0;
    padding: 10px 14px;
    font-size: 13px;
    border-radius: 0;
    border: none;
    border-top: 2px solid transparent;
  }
  .nav-btn.active {
    border-top-color: var(--accent);
    background: transparent;
  }

  /* ---- Left Panel internals ---- */
  .panel-left { padding: 10px; gap: 8px; }

  /* Sections */
  .section { padding: 10px; }
  .section-title { font-size: 12px; margin-bottom: 8px; }

  /* Presets → 3 columns */
  .preset-grid { grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .preset-btn { padding: 6px 4px; font-size: 10px; }
  .preset-sub { display: none; }

  /* Add Line Form → 2-row stack */
  .add-line-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto auto;
    gap: 6px;
  }
  .add-line-form .select { grid-column: 1 / -1; flex: unset; min-width: unset; font-size: 13px; padding: 8px; height: 38px; }
  .add-line-form .variant-select { grid-column: 1 / -1; flex: unset; min-width: unset; font-size: 13px; padding: 8px; height: 38px; }
  .add-line-form .count-input { grid-column: 1; flex: unset; width: 100%; height: 38px; font-size: 13px; text-align: left; }
  .add-line-form .eff-input { grid-column: 2; flex: unset; width: 100%; height: 38px; font-size: 13px; text-align: left; }
  .add-line-form .btn-primary { grid-column: 1 / -1; width: 100%; height: 38px; font-size: 14px; }

  /* Line list */
  .line-list { max-height: 140px; }
  .line-item { flex-wrap: wrap; }
  .line-name { flex: 1 1 60%; font-size: 12px; }
  .line-meta { flex: 1 1 100%; font-size: 10px; margin-top: 2px; }

  /* Power Grid → 2-column grid */
  .power-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .power-label {
    flex-wrap: wrap;
    font-size: 11px;
    padding: 4px 6px;
    background: var(--surface);
    border-radius: 6px;
    border: 1px solid var(--border);
  }
  .power-label input { width: 32px; height: 24px; font-size: 12px; }
  .power-val { display: none; }
  .power-summary { margin-top: 6px; font-size: 11px; }

  /* Limits */
  .limits-grid { gap: 4px; }
  .limit-item { gap: 4px; }
  .limit-item .input { width: 50px; }
  .add-limit-form { flex-wrap: wrap; gap: 4px; }
  .add-limit-form .select { flex: 1; font-size: 12px; }
  .add-limit-form .input { width: 50px; }

  /* Calculate button */
  .btn-calculate {
    font-size: 14px;
    padding: 12px;
  }

  /* ---- Right Panel / Results ---- */
  .panel-right { padding: 10px; }

  /* Result cards → 1 column */
  .result-cards { grid-template-columns: 1fr; gap: 8px; }
  .card-dispatch .card-value { font-size: 20px; }
  .card-success .card-value, .card-danger .card-value { font-size: 16px; }

  /* Tables → horizontal scroll */
  .result-table { display: block; overflow-x: auto; white-space: nowrap; font-size: 11px; }
  .result-section { padding: 10px; }
  .result-section .section-title { font-size: 12px; }

  /* Footer hide */
  .footer { display: none; }

  /* Main bottom padding for nav bar */
  .main { padding-bottom: 0; }
}
</style>
