/**
 * 生成 SQLite 数据库文件（用于下载/迁移）
 * 运行: node generate_db.js
 */
import initSqlJs from 'sql.js'
import { RECIPES } from './src/data/recipes.js'
import fs from 'fs'

const SQL = await initSqlJs()
const db = new SQL.Database()
db.run('PRAGMA foreign_keys = ON')

// 建表
db.run(`
  CREATE TABLE machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    power_kw INTEGER NOT NULL DEFAULT 5,
    category TEXT
  )
`)

db.run(`
  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    is_raw INTEGER NOT NULL DEFAULT 0
  )
`)

db.run(`
  CREATE TABLE recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    machine_id INTEGER NOT NULL,
    time INTEGER NOT NULL,
    category TEXT,
    FOREIGN KEY (machine_id) REFERENCES machines(id)
  )
`)

db.run(`
  CREATE TABLE recipe_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    amount_per_min REAL NOT NULL,
    output_type TEXT NOT NULL DEFAULT 'main',
    FOREIGN KEY (recipe_id) REFERENCES recipes(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )
`)

db.run(`
  CREATE TABLE recipe_inputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    amount_per_min REAL NOT NULL,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )
`)

db.run(`
  CREATE TABLE recipe_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    power_json TEXT,
    lines_json TEXT
  )
`)

// 种子数据
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

for (const r of RECIPES) {
  const machineId = machineMap[r.machine]
  if (!machineId) continue

  const batchesPerMin = r.time > 0 ? 60 / r.time : 0

  db.run(`
    INSERT INTO recipes (recipe_id, name, machine_id, time, category)
    VALUES (?, ?, ?, ?, ?)`,
    [r.id, r.name, machineId, r.time, r.category]
  )

  const idResult = db.exec(`SELECT id FROM recipes WHERE recipe_id = '${r.id.replace(/'/g, "''")}'`)
  if (!idResult.length || !idResult[0].values.length) continue
  const recipeDbId = idResult[0].values[0][0]

  const mainProductId = productMap[r.product]
  if (mainProductId) {
    db.run(`
      INSERT INTO recipe_products (recipe_id, product_id, amount_per_min, output_type)
      VALUES (?, ?, ?, 'main')`,
      [recipeDbId, mainProductId, r.productPerMin]
    )
  }

  if (r.secondaryOutput) {
    const secProductId = productMap[r.secondaryOutput]
    if (secProductId) {
      db.run(`
        INSERT INTO recipe_products (recipe_id, product_id, amount_per_min, output_type)
        VALUES (?, ?, ?, 'secondary')`,
        [recipeDbId, secProductId, r.productPerMin]
      )
    }
  }

  for (const [prodName, batchAmount] of Object.entries(r.inputs || {})) {
    const inputProdId = productMap[prodName]
    if (inputProdId) {
      db.run(
        `INSERT INTO recipe_inputs (recipe_id, product_id, amount_per_min) VALUES (?, ?, ?)`,
        [recipeDbId, inputProdId, batchAmount * batchesPerMin]
      )
    }
  }
}

// 导出 .db 文件
const data = db.export()
const buffer = Buffer.from(data)
fs.writeFileSync('/home/agentuser/endfield.db', buffer)

console.log('Database written to /home/agentuser/endfield.db')

// 验证
const count = db.exec('SELECT COUNT(*) FROM recipes')
console.log(`Total recipes: ${count[0].values[0][0]}`)
const prodCount = db.exec('SELECT COUNT(*) FROM products')
console.log(`Total products: ${prodCount[0].values[0][0]}`)