/**
 * Linear Programming Optimizer for Dispatch Value Maximization
 * Uses or-tools-wasm MPSolver for mixed-integer programming
 *
 * Goal: Given limited raw materials, maximize dispatch ticket output
 */
import { getAllRecipesWithInputs } from './db.js'
import { DISPATCH_VALUE } from './data/recipes.js'

// Maximum number of machines per recipe (practical limit to avoid explosion)
const MAX_MACHINES = 100

/**
 * Build and solve the LP/MIP problem
 * @param {Object} rawLimits - { materialName: maxAmountPerMin }
 * @param {Object} powerLimits - { powerSourceName: count } (optional, currently unused)
 * @returns {Promise<Object>} - { status, dispatchPerMin, lines: [{recipeId, machineCount}], solveTimeMs }
 */
export async function optimizeDispatch(rawLimits = {}, powerLimits = {}) {
  // Get all recipes from the database
  const recipes = getAllRecipesWithInputs()
  if (!recipes || recipes.length === 0) {
    return { status: 'NO_DATA', dispatchPerMin: 0, lines: [], solveTimeMs: 0 }
  }

  const orTools = await import('or-tools-wasm')
  await orTools.initMPSolver()
  const MPSolver = orTools.MPSolver

  // ── Step 1: Collect all products and build recipe index ──────────────────────
  // product name -> array of recipe data (with internal db id)
  const productRecipes = {}
  for (const r of recipes) {
    if (!productRecipes[r.name]) productRecipes[r.name] = []
    productRecipes[r.name].push(r)
  }

  // ── Step 2: Identify raw materials (no upstream producer) ───────────────────
  // Build set of all products that have no recipe producing them (i.e., raw materials)
  const allProductsWithRecipes = new Set(recipes.map(r => r.name))
  const rawMaterials = new Set()
  for (const r of recipes) {
    if (r.inputs) {
      for (const ing of Object.keys(r.inputs)) {
        if (!allProductsWithRecipes.has(ing)) {
          rawMaterials.add(ing)
        }
      }
    }
  }

  // ── Step 3: Identify which products are "final" (have dispatch value) ─────
  const dispatchProducts = new Set(Object.keys(DISPATCH_VALUE))

  // ── Step 4: Build the LP model ─────────────────────────────────────────────
  const solver = MPSolver.CreateSolver('SCIP_MIXED_INTEGER_PROGRAMMING')
  if (!solver) {
    throw new Error('Failed to create MIP solver. SCIP not available.')
  }

  // Decision variables: machine count for each recipe
  // Use continuous (NumVar) since fractional machines can be useful for rate balancing
  const recipeVars = {} // recipeDbId -> variable
  for (const r of recipes) {
    recipeVars[r.id] = solver.NumVar(0, MAX_MACHINES, `m_${r.id}`)
  }

  // Objective: Maximize dispatch value per minute
  const objective = solver.Objective()
  objective.SetMaximization()

  for (const r of recipes) {
    const dispatchVal = DISPATCH_VALUE[r.product] || 0
    if (dispatchVal <= 0) continue

    // Production rate = productPerMin (per machine) * machine count
    // We sum across all lines producing the same product
    // Actually each recipe variable IS the machine count, so:
    const ratePerMachine = r.outputs?.main?.amount || 0
    objective.SetCoefficient(recipeVars[r.id], dispatchVal * ratePerMachine)
  }

  // ── Step 5: Add constraints ───────────────────────────────────────────────
  // For each raw material: total consumption <= supply limit
  const rawMatsWithLimit = Object.keys(rawLimits).filter(k => (rawLimits[k] || 0) > 0)

  for (const mat of rawMatsWithLimit) {
    const limit = rawLimits[mat]
    const constraint = solver.Constraint(0, limit, `limit_${mat}`)

    // Find all recipes that consume this material
    for (const r of recipes) {
      if (!r.inputs || !r.inputs[mat]) continue
      // consumption per machine per min = inputAmount * batchesPerMin
      const inputAmount = r.inputs[mat]  // amount per batch
      const batchesPerMin = r.time > 0 ? 60 / r.time : 0
      const consumePerMachine = inputAmount * batchesPerMin

      constraint.SetCoefficient(recipeVars[r.id], consumePerMachine)
    }
  }

  // ── Step 6: Add product flow constraints ──────────────────────────────────
  // For intermediate products (not raw, not final dispatch products):
  // total production - total consumption = 0 (balance constraint)
  // This prevents infinite loops and ensures feasibility

  const intermediateProducts = []
  for (const prod of allProductsWithRecipes) {
    if (rawMaterials.has(prod)) continue
    if (dispatchProducts.has(prod)) continue
    intermediateProducts.push(prod)
  }

  for (const prod of intermediateProducts) {
    // Only add constraint if there are recipes producing AND consuming this product
    const producers = recipes.filter(r => r.name === prod)
    const consumers = recipes.filter(r => r.inputs && r.inputs[prod] !== undefined)

    if (producers.length === 0 || consumers.length === 0) continue

    // Production - Consumption = 0
    const constraint = solver.Constraint(0, 0, `flow_${prod}`)

    for (const r of producers) {
      const ratePerMachine = r.outputs?.main?.amount || 0
      constraint.SetCoefficient(recipeVars[r.id], ratePerMachine)
    }

    for (const r of consumers) {
      const inputAmount = r.inputs[prod]
      const batchesPerMin = r.time > 0 ? 60 / r.time : 0
      const consumePerMachine = inputAmount * batchesPerMin
      constraint.SetCoefficient(recipeVars[r.id], -consumePerMachine)
    }
  }

  // ── Step 7: Solve ─────────────────────────────────────────────────────────
  const startTime = Date.now()

  // Use default parameters for now
  const resultStatus = await solver.Solve()
  const solveTimeMs = Date.now() - startTime

  // ── Step 8: Extract results ─────────────────────────────────────────────────
  const statusMap = {
    1: 'OPTIMAL',
    2: 'FEASIBLE',
    3: 'INFEASIBLE',
    4: 'UNBOUNDED',
    5: 'ABNORMAL',
    6: 'MODEL_INVALID',
    0: 'NOT_SOLVED',
  }
  const status = statusMap[resultStatus] || `UNKNOWN(${resultStatus})`

  if (resultStatus !== 1 && resultStatus !== 2) {
    // Not OPTIMAL or FEASIBLE
    return { status, dispatchPerMin: 0, lines: [], solveTimeMs }
  }

  // Collect lines with non-zero machine count
  const lines = []
  let totalDispatch = 0

  for (const r of recipes) {
    const val = recipeVars[r.id].SolutionValue()
    // Only include lines with significant machine count (>= 0.01 to handle floating point)
    if (val >= 0.01) {
      const ratePerMachine = r.outputs?.main?.amount || 0
      const dispatchVal = DISPATCH_VALUE[r.product] || 0
      const thisDispatch = dispatchVal * ratePerMachine * val
      totalDispatch += thisDispatch

      lines.push({
        recipeId: r.id,
        name: r.name,
        machine: r.machine,
        product: r.product,
        machineCount: Math.max(0.01, val), // minimum to show
        outputPerMin: ratePerMachine * val,
        dispatchPerMin: thisDispatch,
      })
    }
  }

  return {
    status,
    dispatchPerMin: totalDispatch,
    dispatchPerHour: totalDispatch * 60,
    dispatchPerDay: totalDispatch * 60 * 24,
    lines,
    solveTimeMs,
  }
}