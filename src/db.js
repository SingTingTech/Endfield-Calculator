/**
 * SQLite Wasm 数据库层
 * 临时替代 localStorage，作为未来的数据库迁移方案
 */
import initSqlJs from '@sqlite.org/sqlite-wasm'
import { RECIPES } from './data/recipes.js'

let db = null
let SQL = null

// ----- 公开 API -----

export async function initDB() {
  if (db) return db

  SQL = await initSqlJs({
    locateFile: file => `/node_modules/@sqlite.org/sqlite-wasm/${file}`
  })

  db = new SQL.Database()
  db.run('PRAGMA foreign_keys = ON')

  createTables()
  seedData()

  return db
}

export function getRecipesByMachine(machineName) {
  const result = db.exec(`
    SELECT r.recipe_id, r.name, p.name, r.product_per_min, r.time, r.category
    FROM recipes r
    JOIN machines m ON r.machine_id = m.id
    JOIN products p ON r.product_id = p.id
    WHERE m.name = '${safe(machineName)}'
  `)

  if (!result.length || !result[0].values.length) return []

  return result[0].values.map(row => ({
    recipe_id: row[0],
    name: row[1],
    product: row[2],
    productPerMin: row[3],
    time: row[4],
    category: row[5]
  }))
}

export function getAllRecipesWithInputs() {
  const result = db.exec(`
    SELECT r.id, r.recipe_id, r.name, m.name as machine,
           p.name as product, r.product_per_min, r.time,
           r.category, r.secondary_output
    FROM recipes r
    JOIN machines m ON r.machine_id = m.id
    JOIN products p ON r.product_id = p.id
  `)

  if (!result.length) return []

  return result[0].values.map(row => {
    const recipeDbId = row[0]
    const inputs = getRecipeInputs(recipeDbId)
    return {
      id: row[1],
      name: row[2],
      machine: row[3],
      product: row[4],
      productPerMin: row[5],
      time: row[6],
      category: row[7],
      secondaryOutput: row[8],
      inputs
    }
  })
}

export function searchRecipes(keyword) {
  const kw = safe(keyword)
  const result = db.exec(`
    SELECT r.recipe_id, r.name, m.name, p.name, r.product_per_min, r.time
    FROM recipes r
    JOIN machines m ON r.machine_id = m.id
    JOIN products p ON r.product_id = p.id
    WHERE r.name LIKE '%${kw}%' OR p.name LIKE '%${kw}%'
  `)

  if (!result.length) return []
  return result[0].values.map(row => ({
    recipe_id: row[0], name: row[1], machine: row[2],
    product: row[3], productPerMin: row[4], time: row[5]
  }))
}

export function savePreset(name, description, powerObj, linesArr) {
  db.run(
    `INSERT OR REPLACE INTO recipe_presets (name, description, power_json, lines_json)
     VALUES (?, ?, ?, ?)`,
    [name, description, JSON.stringify(powerObj), JSON.stringify(linesArr)]
  )
}

export function loadPresets() {
  const result = db.exec('SELECT name, description, power_json, lines_json FROM recipe_presets')
  if (!result.length) return []
  return result[0].values.map(row => ({
    name: row[0],
    description: row[1],
    power: JSON.parse(row[2] || '{}'),
    lines: JSON.parse(row[3] || '[]')
  }))
}

export function getMachineName(id) {
  const r = db.exec(`SELECT name FROM machines WHERE id = ${id}`)
  return r.length && r[0].values.length ? r[0].values[0][0] : null
}

// ----- 内部方法 -----

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      power_kw INTEGER NOT NULL DEFAULT 5,
      category TEXT
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_raw INTEGER NOT NULL DEFAULT 0
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      machine_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_per_min REAL NOT NULL,
      time INTEGER NOT NULL,
      category TEXT,
      secondary_output TEXT,
      FOREIGN KEY (machine_id) REFERENCES machines(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS recipe_inputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS recipe_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      power_json TEXT,
      lines_json TEXT
    )
  `)
}

function seedData() {
  // 检查是否已初始化
  const count = db.exec('SELECT COUNT(*) FROM machines')
  if (count.length && count[0].values[0][0] > 0) return

  // 插入机器
  const machines = [
    ['灌装机', 20, '灌装机'],
    ['拆解机', 20, '拆解机'],
    ['精炼炉', 5, '精炼炉'],
    ['封装机', 20, '封装机'],
    ['粉碎机', 20, '粉碎机'],
    ['采种机', 5, '采种机'],
    ['反应池', 15, '反应池'],
    ['扩容反应池', 30, '扩容反应池'],
    ['配件机', 20, '配件机'],
    ['塑形机', 20, '塑形机'],
    ['研磨机', 20, '研磨机'],
    ['种植机', 5, '种植机'],
    ['装备原件机', 20, '装备原件机'],
    ['天有洪炉', 25, '天有洪炉'],
    ['提纯机', 15, '提纯机'],
    ['采集设备', 5, '采集设备'],
  ]

  const machineMap = {}
  for (const [name, power, cat] of machines) {
    db.run(
      'INSERT OR IGNORE INTO machines (name, power_kw, category) VALUES (?, ?, ?)',
      [name, power, cat]
    )
    const r = db.exec(`SELECT id FROM machines WHERE name = '${name}'`)
    if (r.length) machineMap[name] = r[0].values[0][0]
  }

  // 收集所有产品
  const productNames = new Set()
  const rawMaterials = new Set([
    '紫晶矿', '蓝铁矿', '赤铜矿', '赫铜矿', '源矿',
    '清水', '污水', '沉积酸', '驮兽粪便',
    '灰芦麦', '苦叶椒', '琼叶参', '金石稻',
    '荞花', '柑实', '砂叶', '锦草', '芽针', '酮化灌木',
    '灰芦麦种子', '苦叶椒种子', '琼叶参种子', '金石稻种子',
  ])

  for (const r of RECIPES) {
    productNames.add(r.product)
    for (const name of Object.keys(r.inputs || {})) {
      productNames.add(name)
    }
  }

  const productMap = {}
  for (const name of [...productNames]) {
    db.run(
      'INSERT OR IGNORE INTO products (name, is_raw) VALUES (?, ?)',
      [name, rawMaterials.has(name) ? 1 : 0]
    )
    const r = db.exec(`SELECT id FROM products WHERE name = '${name}'`)
    if (r.length) productMap[name] = r[0].values[0][0]
  }

  // 插入配方
  for (const r of RECIPES) {
    const machineId = machineMap[r.machine]
    const productId = productMap[r.product]
    if (!machineId || !productId) continue

    // 先获取已有 recipe_id 对应的 db id
    let existingId = null
    const existing = db.exec(
      `SELECT id FROM recipes WHERE recipe_id = '${safe(r.id)}'`
    )
    if (existing.length && existing[0].values.length) {
      existingId = existing[0].values[0][0]
    }

    if (!existingId) {
      db.run(`
        INSERT INTO recipes
          (recipe_id, name, machine_id, product_id, product_per_min, time, category, secondary_output)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.name, machineId, productId, r.productPerMin, r.time, r.category, r.secondaryOutput || null]
      )
      const idResult = db.exec(
        `SELECT id FROM recipes WHERE recipe_id = '${safe(r.id)}'`
      )
      if (idResult.length) existingId = idResult[0].values[0][0]
    }

    if (!existingId) continue

    // 插入原料（先清除旧的）
    db.run(`DELETE FROM recipe_inputs WHERE recipe_id = ${existingId}`)

    for (const [prodName, amount] of Object.entries(r.inputs || {})) {
      const inputProdId = productMap[prodName]
      if (inputProdId) {
        db.run(
          `INSERT INTO recipe_inputs (recipe_id, product_id, amount) VALUES (?, ?, ?)`,
          [existingId, inputProdId, amount]
        )
      }
    }
  }
}

function getRecipeInputs(recipeDbId) {
  const result = db.exec(`
    SELECT pr.name, ri.amount
    FROM recipe_inputs ri
    JOIN products pr ON ri.product_id = pr.id
    WHERE ri.recipe_id = ${recipeDbId}
  `)

  if (!result.length) return {}
  const inputs = {}
  for (const row of result[0].values) {
    inputs[row[0]] = row[1]
  }
  return inputs
}

// SQL 注入防护（简单转义）
function safe(str) {
  return String(str).replace(/'/g, "''")
}