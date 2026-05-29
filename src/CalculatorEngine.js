// 计算引擎 - 完整上游溯源版本 v3
// 核心：以用户配置的产线为图，用配方库判定每个原料是否有真实生产者
import { RECIPE_MAP, DISPATCH_VALUE, MACHINE_POWER, POWER_GEN, RECIPES, PRODUCT_VARIANTS } from './data/recipes.js'

// 农场产出（不显示在原料消耗中）
const FARM_PRODUCTS = new Set([
  '荞花', '柑实', '锦草', '砂叶', '酮化灌木', '芽针',
  '灰芦麦', '苦叶椒', '琼叶参', '金石稻',
  '荞花种子', '柑实种子', '锦草种子', '砂叶种子', '酮化树种',
  '芽针种子', '灰芦麦种子', '苦叶椒种子', '琼叶参种子', '金石稻种子',
  '息壤', '重息壤', '实验重息壤',
])

// 建立 product -> recipe 映射（同一产品可能有多条配方，取第一条，即普通版优先）
const PRODUCT_RECIPE_MAP = {}
for (const r of RECIPES) {
  if (r.product && !PRODUCT_RECIPE_MAP[r.product]) {
    PRODUCT_RECIPE_MAP[r.product] = r
  }
}

// 判断某产品是否有配方（即是否可被生产）
function hasRecipe(product) {
  return PRODUCT_RECIPE_MAP[product] !== undefined
}

class ProductionLine {
  constructor(recipe, count = 1, efficiency = 1.0) {
    this.recipe = recipe
    this.count = count
    this.efficiency = efficiency
  }

  get powerKw() {
    return (MACHINE_POWER[this.recipe.machine] || 0) * this.count
  }
}

export function calculate(activeLines, powerSources, rawLimits) {
  if (!activeLines || activeLines.length === 0) {
    return makeEmptyResults()
  }

  // ── Step 1: 建立产线索引 ────────────────────────────────────
  // product -> indices of lines that produce it
  const lineIdxByProduct = {}
  for (let i = 0; i < activeLines.length; i++) {
    const prod = activeLines[i].recipe.product
    if (!lineIdxByProduct[prod]) lineIdxByProduct[prod] = []
    lineIdxByProduct[prod].push(i)
  }

  // ── Step 2: 判定每条产线的原料来源 ──────────────────────────
  // 对于每条产线的每个输入，判断：
  //   - 如果该输入产品在配置内有生产者 → 依赖配置内产线
  //   - 如果该输入产品在配方库有其他配方（可被生产）→ 外部购入原料
  //   - 如果该输入产品在配方库没有配方 → 原始原料
  //
  // 产线分类：
  //   - 根产线：所有输入要么是原始原料，要么是外部购入
  //   - 中间产线：至少有一个输入来自配置内其他产线
  //
  // 注意：此步的 lineIsRoot 判定可能在 autoExpandUpstream 展开不完整时出错
  // 因此 Step 4 会动态重新计算 isRoot，此处结果仅作参考
  const lineIsRoot = {}      // i -> bool（是否根产线）仅供参考
  const lineExternalInputs = {}  // i -> { product: amount }（外部购入原料）仅供参考

  for (let i = 0; i < activeLines.length; i++) {
    const line = activeLines[i]
    if (!line.recipe.inputs || Object.keys(line.recipe.inputs).length === 0) {
      lineIsRoot[i] = true
      lineExternalInputs[i] = {}
      continue
    }

    let isRoot = true
    const external = {}
    const batchesPerMin = 60 / (line.recipe.time || 1)

    for (const [ing, needPerMachine] of Object.entries(line.recipe.inputs)) {
      const totalNeed = needPerMachine * line.count * batchesPerMin
      // 配置内是否有生产者？
      const upstreamLines = lineIdxByProduct[ing] || []
      if (upstreamLines.length > 0) {
        isRoot = false  // 有配置内上游依赖
      } else if (hasRecipe(ing)) {
        // 配方库有配方 = 外部购入
        external[ing] = totalNeed
      } else {
        // 配方库没有 = 原始原料
        external[ing] = totalNeed
      }
    }

    lineIsRoot[i] = isRoot
    lineExternalInputs[i] = external
  }

  // ── 动态 isRoot 计算函数（Step 4 使用）────────────────────────
  // 在拓扑排序完成后，所有配置内依赖关系已明确，此时判定才正确
  function computeIsRoot(lineIdx) {
    const line = activeLines[lineIdx]
    if (!line.recipe.inputs || Object.keys(line.recipe.inputs).length === 0) {
      return true  // 无投入品 = 根
    }
    for (const ing of Object.keys(line.recipe.inputs)) {
      const upIdxs = lineIdxByProduct[ing] || []
      if (upIdxs.length > 0) return false  // 有配置内上游 = 非根
    }
    return true  // 所有原料都来自外部 = 根
  }

  // 动态计算某条线的外部购入原料（配置内无生产者的投入品）
  function computeExternalInputs(lineIdx) {
    const line = activeLines[lineIdx]
    const external = {}
    if (!line.recipe.inputs) return external
    const batchesPerMin = 60 / (line.recipe.time || 1)
    for (const [ing, needPerMachine] of Object.entries(line.recipe.inputs)) {
      const totalNeed = needPerMachine * line.count * batchesPerMin
      const upstreamLines = lineIdxByProduct[ing] || []
      if (upstreamLines.length === 0) {
        // 配置内无生产者 = 外部购入或原始原料
        external[ing] = totalNeed
      }
    }
    return external
  }

  // ── Step 3: 拓扑排序（仅基于配置内依赖）───────────────────────
  // 迭代版 collectDeps，避免递归栈溢出
  // 支持检测环形依赖
  const upstreamDeps = {}  // i -> set of upstream line indices

  for (let i = 0; i < activeLines.length; i++) {
    if (upstreamDeps[i] !== undefined) continue
    const stack = [i]
    const onStack = new Set([i])    // 检测环：追踪当前栈上的节点
    const visited = new Set()
    while (stack.length > 0) {
      const idx = stack[stack.length - 1]
      if (visited.has(idx)) {
        // 已经处理完所有下游依赖，可以安全弹出
        onStack.delete(idx)
        stack.pop()
        continue
      }
      if (upstreamDeps[idx] !== undefined) {
        // 已计算过，直接弹出
        onStack.delete(idx)
        stack.pop()
        continue
      }
      const line = activeLines[idx]
      const directDeps = new Set()
      let hasDepOnStack = false  // 检测是否有依赖在当前栈上（环）

      if (line.recipe.inputs) {
        for (const ing of Object.keys(line.recipe.inputs)) {
          const upIdxs = lineIdxByProduct[ing] || []
          for (const upIdx of upIdxs) {
            directDeps.add(upIdx)
            if (onStack.has(upIdx)) {
              // 环形依赖！标记环节点
              hasDepOnStack = true
            } else if (upstreamDeps[upIdx] === undefined) {
              // 未计算过的依赖，优先处理
              onStack.add(upIdx)
              stack.push(upIdx)
            }
          }
        }
      }

      if (hasDepOnStack) {
        // 环形 → 不继续等待，直接完成当前节点
        // 环形内的依赖不算作 upstream
        visited.add(idx)
        onStack.delete(idx)
        stack.pop()
        upstreamDeps[idx] = directDeps
      } else if (directDeps.size === 0 || [...directDeps].every(d => upstreamDeps[d] !== undefined)) {
        // 所有直接依赖都已计算完毕
        visited.add(idx)
        onStack.delete(idx)
        stack.pop()
        // Merge all sub-deps
        const all = new Set(directDeps)
        for (const d of directDeps) {
          const sub = upstreamDeps[d]
          if (sub) sub.forEach(s => all.add(s))
        }
        upstreamDeps[idx] = all
      }
      // else: 栈顶节点有未计算的依赖，while会继续循环处理栈顶
    }
  }

  // 迭代版 getLevel：基于已有 upstreamDeps 计算层级
  const lineLevels = {}
  for (let i = 0; i < activeLines.length; i++) {
    const deps = upstreamDeps[i]
    if (!deps || deps.size === 0) {
      lineLevels[i] = 0
    } else {
      let max = 0
      for (const d of deps) max = Math.max(max, lineLevels[d] + 1)
      lineLevels[i] = max
    }
  }

  const linesByLevel = {}
  for (let i = 0; i < activeLines.length; i++) {
    const lvl = lineLevels[i]
    if (!linesByLevel[lvl]) linesByLevel[lvl] = []
    linesByLevel[lvl].push(i)
  }

  const levels = Object.keys(linesByLevel).map(Number).sort((a, b) => a - b)

  // ── Step 4: 计算每条线的实际产出 ────────────────────────────
  const production = {}
  const efficiency = {}
  const lineActualConsume = {}

  for (const lvl of levels) {
    for (const i of linesByLevel[lvl]) {
      const line = activeLines[i]
      const recipe = line.recipe
      const isRoot = computeIsRoot(i)  // 动态判定（拓扑排序后）

      if (isRoot) {
        // 根产线：rawLimits 限制
        const rawLimit = rawLimits[recipe.product]
        let eff = line.efficiency
        if (rawLimit !== undefined) {
          const maxPossible = recipe.productPerMin * line.count
          if (rawLimit < maxPossible) {
            eff = line.efficiency * (rawLimit / maxPossible)
          }
        }
        efficiency[i] = eff
        production[i] = recipe.productPerMin * line.count * eff
        lineActualConsume[i] = computeExternalInputs(i)
      } else {
        // 加工线：找上游瓶颈
        let minEff = 1.0
        const consume = {}
        const isFarmProduct = FARM_PRODUCTS.has(recipe.product)

        for (const [ing, needPerMachine] of Object.entries(recipe.inputs)) {
          // 每分钟需求 = 每台每批需要量 × 机器数 × 每分钟批次数
          const batchesPerMin = 60 / (recipe.time || 1)
          const totalNeed = needPerMachine * line.count * batchesPerMin
          // 找配置内上游产出
          let srcOutput = 0
          let hasSameOrLowerLevel = false
          const upstreamIdxs = lineIdxByProduct[ing] || []
          for (const upIdx of upstreamIdxs) {
            const upLvl = lineLevels[upIdx]
            if (upLvl < lineLevels[i]) {
              // 下游先于上游处理，直接用实际产出
              srcOutput += production[upIdx] || 0
              hasSameOrLowerLevel = true
            } else if (upLvl === lineLevels[i]) {
              // 同 level：可能是 farm 循环或还没处理的线
              // farm 产品之间的循环用理论产能解环；其余情况用生产者的理论产能
              const upRecipe = activeLines[upIdx].recipe
              srcOutput += (upRecipe.productPerMin || 1) * activeLines[upIdx].count
              hasSameOrLowerLevel = true
            }
          }
          // farm 产品的 farm 原料始终视为充足（循环自洽）
          const isFarmIngredient = FARM_PRODUCTS.has(ing) && isFarmProduct
          const satisfy = (totalNeed > 0 && hasSameOrLowerLevel)
            ? Math.min(srcOutput / totalNeed, 1.0)
            : 1.0
          if (satisfy < minEff) minEff = satisfy
          consume[ing] = needPerMachine * line.count * (isFarmIngredient ? 1.0 : satisfy) * batchesPerMin
        }

        const eff = minEff * line.efficiency
        efficiency[i] = eff
        production[i] = recipe.productPerMin * line.count * eff
        // 外部购入原料也要记录
        const allConsume = { ...computeExternalInputs(i) }
        for (const [k, v] of Object.entries(consume)) {
          allConsume[k] = (allConsume[k] || 0) + v
        }
        lineActualConsume[i] = allConsume
      }
    }
  }

  // ── Step 5: 汇总 ────────────────────────────────────────────
  const totalProduced = {}
  const totalConsumed = {}

  for (let i = 0; i < activeLines.length; i++) {
    const prod = activeLines[i].recipe.product
    totalProduced[prod] = (totalProduced[prod] || 0) + production[i]
    for (const [ing, amt] of Object.entries(lineActualConsume[i])) {
      totalConsumed[ing] = (totalConsumed[ing] || 0) + amt
    }
  }

  const netOutput = {}
  for (const prod of Object.keys(totalProduced)) {
    netOutput[prod] = totalProduced[prod] - (totalConsumed[prod] || 0)
  }

  // ── Step 6: 区分最终产品和中间产物 ──────────────────────────
  // 规则：被配置内其他产线消费的产品 = 中间产物
  //       没有被任何配置内产线消费的产品 = 最终产品
  const consumedInternally = new Set()
  for (const line of activeLines) {
    if (line.recipe.inputs) {
      for (const ing of Object.keys(line.recipe.inputs)) {
        const upstreamIdxs = lineIdxByProduct[ing] || []
        if (upstreamIdxs.length > 0) {
          consumedInternally.add(ing)
        }
      }
    }
  }

  const finalProducts = {}
  const intermediateProducts = {}

  for (const [prod, outputAmt] of Object.entries(totalProduced)) {
    if (consumedInternally.has(prod)) {
      intermediateProducts[prod] = {
        产出: outputAmt,
        消耗: totalConsumed[prod] || 0,
        余量: netOutput[prod] || 0,
      }
    } else {
      finalProducts[prod] = outputAmt
    }
  }

  // ── Step 7: 原料消耗 ─────────────────────────────────────────
  // 外部购入的原料（配方库有配方但配置内无生产者的产品）
  const rawConsume = {}
  for (const [prod, consumed] of Object.entries(totalConsumed)) {
    const upstreamIdxs = lineIdxByProduct[prod] || []
    if (upstreamIdxs.length === 0 && !FARM_PRODUCTS.has(prod)) {
      rawConsume[prod] = consumed
    }
  }

  // ── Step 8: 产线详情 ────────────────────────────────────────
  const lineDetails = []
  for (let i = 0; i < activeLines.length; i++) {
    const line = activeLines[i]
    const prod = line.recipe.product
    lineDetails.push({
      lineIndex: i,
      recipeName: line.recipe.name,
      machine: line.recipe.machine,
      product: prod,
      count: line.count,
      efficiency: efficiency[i],
      grossOutput: production[i],
      actualOutput: production[i],
      consume: lineActualConsume[i],
      level: lineLevels[i],
      powerKw: line.powerKw,
      dispatchValue: (DISPATCH_VALUE[prod] || 0) * production[i],
      isRoot: computeIsRoot(i),  // 使用动态判定（拓扑排序后）
    })
  }

  // ── Step 9: 电力 & 调度券 ───────────────────────────────────
  let powerConsume = 0
  for (const line of activeLines) powerConsume += line.powerKw
  let powerGen = 0
  for (const [src, cnt] of Object.entries(powerSources)) {
    powerGen += (POWER_GEN[src]?.power || 0) * cnt
  }
  let dispatchPerMin = 0
  for (const [prod, amt] of Object.entries(totalProduced)) {
    dispatchPerMin += amt * (DISPATCH_VALUE[prod] || 0)
  }

  // ── Step 10: 组装结果 ────────────────────────────────────────
  const results = {
    lineDetails,
    intermediateProducts,
    finalProducts,
    rawConsume,
    powerConsume,
    powerGen,
    dispatchPerMin,
    dispatchPerHour: dispatchPerMin * 60,
    dispatchPerDay: dispatchPerMin * 60 * 24,
    warnings: [],
  }

  if (powerConsume > powerGen) {
    results.warnings.push({
      type: 'danger',
      text: `⚠️ 电力不足！需要 ${powerConsume.toFixed(0)}kW，当前发电 ${powerGen.toFixed(0)}kW，缺 ${(powerConsume - powerGen).toFixed(0)}kW`,
    })
  } else if (powerGen > 0) {
    results.warnings.push({
      type: 'success',
      text: `💡 电力充足，盈余 ${(powerGen - powerConsume).toFixed(0)}kW`,
    })
  }

  for (const [prod, needed] of Object.entries(rawConsume)) {
    const available = rawLimits[prod]
    if (available !== undefined && available < needed - 0.001) {
      results.warnings.push({
        type: 'danger',
        text: `⚠️ 原料不足：${prod} 需要 ${needed.toFixed(2)}/min，但上限仅 ${available.toFixed(2)}/min`,
      })
    }
  }

  return results
}

function makeEmptyResults() {
  return {
    lineDetails: [],
    intermediateProducts: {},
    finalProducts: {},
    rawConsume: {},
    powerConsume: 0,
    powerGen: 0,
    dispatchPerMin: 0,
    dispatchPerHour: 0,
    dispatchPerDay: 0,
    warnings: [],
  }
}

export function createLine(recipeId, count = 1, efficiency = 1.0) {
  const recipe = RECIPE_MAP[recipeId]
  if (!recipe) return null
  return new ProductionLine(recipe, count, efficiency)
}

// farm 循环产线固定配比（机器数: 种植机×N, 采种机×1）
// key: farm 产品名，value: {seedMachine, plantMachine, seedRatio, plantRatio}
const FARM_LOOP_CONFIG = {
  '荞花':      { seedId: '采种机-荞花种子',   plantId: '种植机-荞花',   seedRatio: 1, plantRatio: 2 },
  '柑实':      { seedId: '采种机-柑实种子',   plantId: '种植机-柑实',   seedRatio: 1, plantRatio: 2 },
  '砂叶':      { seedId: '采种机-砂叶种子',   plantId: '种植机-砂叶',   seedRatio: 1, plantRatio: 2 },
  '锦草':      { seedId: '采种机-锦草种子',   plantId: '种植机-锦草',   seedRatio: 1, plantRatio: 1 },
  '芽针':      { seedId: '采种机-芽针种子',   plantId: '种植机-芽针',   seedRatio: 1, plantRatio: 1 },
  '灰芦麦':    { seedId: '采种机-灰芦麦种子', plantId: '种植机-灰芦麦', seedRatio: 1, plantRatio: 1 },
  '苦叶椒':    { seedId: '采种机-苦叶椒种子', plantId: '种植机-苦叶椒', seedRatio: 1, plantRatio: 1 },
  '琼叶参':    { seedId: '采种机-琼叶参种子', plantId: '种植机-琼叶参', seedRatio: 1, plantRatio: 1 },
  '金石稻':    { seedId: '采种机-金石稻种子', plantId: '种植机-金石稻', seedRatio: 1, plantRatio: 1 },
  '酮化灌木':  { seedId: '采种机-酮化树种',   plantId: '种植机-酮化灌木', seedRatio: 1, plantRatio: 1 },
}

// 自动递归展开上游产线
// 策略：计算每条下游线对各原料的"需求率"（每分钟需要的量），
//       向上追溯时按需求精确计算机器数，不多开
export function autoExpandUpstream(activeLines) {
  if (!activeLines || activeLines.length === 0) return []

  // 深拷贝原始产线（保留用户设置的 count 和 efficiency）
  const result = activeLines.map(l => new ProductionLine(l.recipe, l.count, l.efficiency))

  // 追踪 result 中每条线对各产品的需求率（每分钟需要的量）
  // 这个demandRate在展开过程中会累积下游的真实需求
  const demandRate = {}  // { product: amountPerMin }

  // 初始化demandRate：计算原始用户线的原料需求（每分钟实际需要的量）
  for (const line of result) {
    if (!line.recipe.inputs) continue
    const outputRate = line.count * (line.efficiency || 1.0) * (line.recipe.productPerMin || 1)
    for (const [ing, needPerMachine] of Object.entries(line.recipe.inputs)) {
      const need = needPerMachine * outputRate
      demandRate[ing] = (demandRate[ing] || 0) + need
    }
  }

  // 已被上游覆盖的产品（在result中有生产者）
  const coveredProducts = new Set()
  for (const line of result) {
    coveredProducts.add(line.recipe.product)
  }

  // 迭代展开
  let changed = true
  let iterations = 0
  while (changed && iterations < 30) {
    changed = false
    iterations++

    // 每次从头扫描result（新的线上可能有新的原料需求）
    for (let i = 0; i < result.length; i++) {
      const line = result[i]
      if (!line.recipe.inputs) continue

      for (const [ing, needPerMachine] of Object.entries(line.recipe.inputs)) {
        // 农场循环：自动展开种+收配比
        if (FARM_LOOP_CONFIG[ing]) {
          // 已在result中有生产者，跳过
          if (coveredProducts.has(ing)) continue
          const cfg = FARM_LOOP_CONFIG[ing]
          const seedRecipe = RECIPE_MAP[cfg.seedId]
          const plantRecipe = RECIPE_MAP[cfg.plantId]
          if (!seedRecipe || !plantRecipe) continue

          // 使用demandRate中累积的总需求来计算需要的循环组数
          const totalNeed = demandRate[ing] || 0
          const plantOutputPerCycle = cfg.plantRatio * (plantRecipe.productPerMin || 1)
          const cyclesNeeded = Math.max(1, Math.ceil(totalNeed / plantOutputPerCycle))

          // 检查是否已存在
          const seedExists = result.some(l => l.recipe.id === cfg.seedId)
          const plantExists = result.some(l => l.recipe.id === cfg.plantId)
          if (!seedExists) {
            result.push(new ProductionLine(seedRecipe, cyclesNeeded, 1.0))
            changed = true
          }
          if (!plantExists) {
            result.push(new ProductionLine(plantRecipe, cyclesNeeded * cfg.plantRatio, 1.0))
            changed = true
          }
          // 标记farm产品已覆盖，但不阻止后续展开（farm产出如砂叶仍需要进一步加工）
          // 注意：这里不再用coveredProducts跳过ing，因为farm产出还需要进一步加工
          continue
        }

        // 配置内已有生产者，跳过
        const hasLocalProducer = result.some(l => l.recipe.product === ing)
        if (hasLocalProducer) continue

        // 已被覆盖（已添加过上生产线）
        if (coveredProducts.has(ing)) continue

        // 农场其他产品（种子、原始farm产出）跳过
        if (FARM_PRODUCTS.has(ing)) continue

        // 展开中间产物时，优先使用用户已选择的配方
        // 先看 result 中是否有该产品的产线（用户手动添加的）
        const existingLine = result.find(l => l.recipe.product === ing)
        let upstreamRecipe = null
        if (existingLine) {
          upstreamRecipe = existingLine.recipe
        } else {
          const variants = PRODUCT_VARIANTS[ing] || []
          upstreamRecipe = variants[0] || null
        }
        if (!upstreamRecipe) continue

        // 有投入品的配方 → 递归展开
        if (upstreamRecipe.inputs && Object.keys(upstreamRecipe.inputs).length > 0) {
          // 使用demandRate中累积的总需求来计算
          // demandRate[ing]是从所有下游消费者累积的真实需求
          const totalNeed = demandRate[ing] || 0
          const productPerMin = upstreamRecipe.productPerMin || 1

          // 精确计算机器数：总需求/产量
          // machinesNeeded可能<1，但至少1台（否则整条线无意义）
          const machinesNeeded = Math.max(1, totalNeed / productPerMin)
          // 效率 = 实际需求/理论产能，精确反映实际负载率
          const efficiency = Math.min(totalNeed / (productPerMin * machinesNeeded), 1.0)

          // 添加上游产线
          result.push(new ProductionLine(upstreamRecipe, machinesNeeded, efficiency))
          coveredProducts.add(ing)
          changed = true

          // 累积这个新产线的原料需求到demandRate
          const lineOutputs = productPerMin * machinesNeeded * efficiency
          for (const [upIng, upNeedPerMachine] of Object.entries(upstreamRecipe.inputs)) {
            const upNeed = upNeedPerMachine * lineOutputs
            demandRate[upIng] = (demandRate[upIng] || 0) + upNeed
          }
        } else {
          // 采集类（无投入品）→ 标记为已覆盖，不加产线
          coveredProducts.add(ing)
          changed = true
        }
      }
    }

    // 农场循环被添加后，它产出的产品（如砂叶）需要标记为已覆盖
    // 这样才不会又被常规递归展开处理
    for (const line of result) {
      coveredProducts.add(line.recipe.product)
    }
  }

  return result
}
