<template>
  <div class="recipe-browser">
    <!-- Search & Filter Bar -->
    <div class="filter-bar">
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="🔍 搜索产品或配方名称..."
      />
      <div class="cat-tabs">
        <button
          class="cat-tab"
          :class="{ active: selectedCat === '' }"
          @click="selectedCat = ''"
        >全部</button>
        <button
          v-for="cat in categories"
          :key="cat"
          class="cat-tab"
          :class="{ active: selectedCat === cat }"
          @click="selectedCat = cat"
        >{{ cat }}</button>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-bar">
      共 <strong>{{ filteredRecipes.length }}</strong> 条配方
      <span v-if="searchQuery || selectedCat">（已筛选）</span>
    </div>

    <!-- Recipe Table -->
    <div class="table-wrapper">
      <table class="recipe-table">
        <thead>
          <tr>
            <th class="col-product">产品</th>
            <th class="col-machine">设备</th>
            <th class="col-power">功率</th>
            <th class="col-output">产量/min</th>
            <th class="col-time">耗时</th>
            <th class="col-inputs">配方（输入 → 输出）</th>
            <th class="col-secondary">副产物</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="r in filteredRecipes" :key="r.id">
            <tr class="recipe-row" :class="{ expanded: expandedId === r.id }" @click="toggleExpand(r.id)">
              <td class="col-product">
                <div class="product-cell">
                  <img v-if="getItemImage(r.product)" :src="getItemImage(r.product)" class="item-icon" :alt="r.product" />
                  <span class="product-name">{{ r.product }}</span>
                </div>
              </td>
              <td class="col-machine">
                <img v-if="getMachineImage(r.machine)" :src="getMachineImage(r.machine)" class="machine-icon" :alt="r.machine" />
                <span class="machine-badge" :style="{ background: catColor(r.category) }">
                  {{ r.machine }}
                </span>
              </td>
              <td class="col-power">{{ MACHINE_POWER[r.machine] || '?' }}kW</td>
              <td class="col-output val-num">{{ r.productPerMin }}</td>
              <td class="col-time val-num">{{ r.time }}s</td>
              <td class="col-inputs">
                  <span class="recipe-expr">
                  {{ inputsPerMin(r.inputs, r.time) }} → {{ r.productPerMin }}×{{ r.product }}
                </span>
              </td>
              <td class="col-secondary">{{ r.secondaryOutput || '—' }}</td>
            </tr>
            <!-- Expanded detail row -->
            <tr v-if="expandedId === r.id" class="detail-row">
              <td colspan="7">
                <div class="detail-card">
                  <div class="detail-field">
                    <span class="detail-label">配方ID</span>
                    <span class="detail-value">{{ r.id }}</span>
                  </div>
                  <div class="detail-field">
                    <span class="detail-label">配方全名</span>
                    <span class="detail-value">{{ r.name }}</span>
                  </div>
                  <div class="detail-field">
                    <span class="detail-label">产品图标</span>
                    <img v-if="getItemImage(r.product)" :src="getItemImage(r.product)" style="width:40px;height:40px;object-fit:contain;border-radius:6px;" :alt="r.product" />
                    <span v-else class="detail-value">—</span>
                  </div>
                  <div class="detail-field">
                    <span class="detail-label">产品</span>
                    <span class="detail-value">{{ r.product }}</span>
                  </div>
                  <div class="detail-field">
                    <span class="detail-label">设备</span>
                    <span class="detail-value">{{ r.machine }}（功率 {{ MACHINE_POWER[r.machine] || '?' }}kW）</span>
                  </div>
                  <div class="detail-field">
                    <span class="detail-label">产量</span>
                    <span class="detail-value">{{ r.productPerMin }} 个/分钟</span>
                  </div>
                  <div class="detail-field">
                    <span class="detail-label">耗时</span>
                    <span class="detail-value">{{ r.time }} 秒</span>
                  </div>
                  <div class="detail-field">
                    <span class="detail-label">分类</span>
                    <span class="detail-value">{{ r.category }}</span>
                  </div>
                  <div class="detail-field" v-if="r.secondaryOutput">
                    <span class="detail-label">副产物</span>
                    <span class="detail-value">{{ r.secondaryOutput }}</span>
                  </div>
                  <div class="detail-field" v-if="r.notes">
                    <span class="detail-label">备注</span>
                    <span class="detail-value">{{ r.notes }}</span>
                  </div>
                  <div class="detail-inputs">
                    <span class="detail-label">投入原料：</span>
                    <div class="input-list">
                      <span v-for="(amt, name) in r.inputs" :key="name" class="input-chip">
                        {{ amt }}× {{ name }}
                      </span>
                      <span v-if="!r.inputs || Object.keys(r.inputs).length === 0" class="input-chip none">— 无（采集类）</span>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="filteredRecipes.length === 0">
            <td colspan="7" class="empty-row">没有找到匹配的配方</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { RECIPES, MACHINE_POWER, MACHINE_CATEGORIES } from '../data/recipes.js'
import itemImages from '../data/itemImages.json'
import machineImages from '../data/machineImages.json'

const searchQuery = ref('')
const selectedCat = ref('')
const expandedId = ref(null)

const categories = MACHINE_CATEGORIES

const filteredRecipes = computed(() => {
  let list = RECIPES
  if (selectedCat.value) {
    list = list.filter(r => r.category === selectedCat.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(r =>
      r.product.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      (r.category && r.category.toLowerCase().includes(q))
    )
  }
  return list
})

const catColors = {
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
  '采集设备': '#F2F2F2',
}

function catColor(cat) {
  return catColors[cat] || '#E2EFDA'
}

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id
}

function getItemImage(name) {
  return itemImages[name] || null
}

function getMachineImage(machine) {
  return machineImages[machine] || null
}

// 将单次配方原料数换算为每分钟原料消耗（乘以每分钟完成次数）
function inputsPerMin(inputs, timeSec) {
  if (!inputs || Object.keys(inputs).length === 0) return '—'
  const batchesPerMin = 60 / timeSec
  return Object.entries(inputs)
    .map(([k, v]) => `${(v * batchesPerMin).toFixed(1)}×${k}`)
    .join(' + ')
}

function formatInputs(inputs) {
  if (!inputs || Object.keys(inputs).length === 0) return '—'
  return Object.entries(inputs).map(([k, v]) => `${v}×${k}`).join(' + ')
}
</script>

<style scoped>
.recipe-browser {
  display: flex;
  flex-direction: column;
  flex: 1;
  background: var(--bg);
  overflow: hidden;
}

.filter-bar {
  background: var(--surface);
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.search-input {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 8px 12px;
  font-size: 13px;
  width: 100%;
  font-family: inherit;
}
.search-input:focus {
  outline: none;
  border-color: var(--accent);
}
.search-input::placeholder {
  color: var(--text2);
}

.cat-tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.cat-tab {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  color: var(--text2);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.cat-tab:hover { border-color: var(--accent); color: var(--text); }
.cat-tab.active {
  background: rgba(79, 195, 247, 0.12);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.stats-bar {
  padding: 6px 16px;
  font-size: 11px;
  color: var(--text2);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.stats-bar strong { color: var(--accent); }

.table-wrapper {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
}

.recipe-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.recipe-table thead th {
  position: sticky;
  top: 0;
  background: var(--surface);
  color: var(--text2);
  font-weight: 500;
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  border-bottom: 2px solid var(--border);
  z-index: 1;
}

.col-product { width: 180px; }
.product-cell { display: flex; align-items: center; gap: 6px; }
.item-icon { width: 28px; height: 28px; object-fit: contain; border-radius: 4px; flex-shrink: 0; }
.machine-icon { width: 22px; height: 22px; object-fit: contain; border-radius: 3px; vertical-align: middle; margin-right: 4px; flex-shrink: 0; }

.col-machine { width: 130px; }
.col-power { width: 60px; }
.col-output { width: 70px; }
.col-time { width: 50px; }
.col-inputs { min-width: 200px; }
.col-secondary { width: 120px; }
.val-num { text-align: right; color: var(--accent2); }

.recipe-row {
  cursor: pointer;
  transition: background 0.1s;
}
.recipe-row:hover { background: rgba(79, 195, 247, 0.05); }
.recipe-row.expanded { background: rgba(79, 195, 247, 0.08); }

.recipe-table td {
  padding: 7px 10px;
  border-bottom: 1px solid rgba(45, 63, 90, 0.4);
  vertical-align: middle;
}

.product-name {
  font-weight: 600;
  color: var(--text);
}

.machine-badge {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 10px;
  color: #333;
  font-weight: 600;
}

.recipe-expr {
  font-size: 11px;
  color: var(--text2);
}

.detail-row td {
  padding: 0;
  border-bottom: 2px solid var(--accent);
}

.detail-card {
  background: var(--surface2);
  padding: 14px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  border-left: 3px solid var(--accent);
  margin: 0 0 0 40px;
}

.detail-field {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 160px;
}

.detail-label {
  font-size: 10px;
  color: var(--text2);
  white-space: nowrap;
  min-width: 56px;
}

.detail-value {
  font-size: 12px;
  color: var(--text);
}

.detail-inputs {
  width: 100%;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding-top: 4px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}

.input-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.input-chip {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 11px;
  color: var(--text);
}
.input-chip.none {
  color: var(--text2);
  font-style: italic;
}

.empty-row {
  text-align: center;
  color: var(--text2);
  padding: 40px;
  font-size: 13px;
}

/* Scrollbar */
.table-wrapper::-webkit-scrollbar { width: 4px; }
.table-wrapper::-webkit-scrollbar-track { background: transparent; }
.table-wrapper::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* Mobile Responsive */
@media (max-width: 768px) {
  .filter-bar {
    padding: 10px 12px;
    gap: 8px;
  }
  .search-input {
    font-size: 14px;
    padding: 10px 14px;
  }
  .cat-tabs {
    overflow-x: auto;
    flex-wrap: nowrap;
    scrollbar-width: none;
    gap: 4px;
    padding-bottom: 2px;
  }
  .cat-tabs::-webkit-scrollbar { display: none; }
  .cat-tab {
    flex-shrink: 0;
    padding: 5px 12px;
    font-size: 12px;
  }
  .stats-bar {
    padding: 6px 12px;
    font-size: 11px;
  }
  .table-wrapper {
    padding: 0 8px 12px;
  }
  .table-wrapper {
    overflow-x: auto;
  }
  .recipe-table {
    display: block;
    overflow-x: auto;
    white-space: nowrap;
    font-size: 11px;
  }
  .col-product { width: 130px; }
  .col-machine { width: 100px; }
  .col-power { width: 55px; }
  .col-output { width: 65px; }
  .col-time { width: 45px; }
  .col-inputs { min-width: 160px; }
  .col-secondary { width: 80px; }
  .item-icon { width: 22px; height: 22px; }
  .machine-icon { width: 18px; height: 18px; }
  .machine-badge { font-size: 9px; padding: 2px 5px; }
  .recipe-expr { font-size: 10px; }
  .detail-card {
    margin-left: 0;
    padding: 12px;
    gap: 8px 16px;
  }
  .detail-field {
    min-width: 140px;
    flex: 1 1 45%;
  }
}
</style>
