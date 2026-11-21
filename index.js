import chalk from "chalk"
import fs from "node:fs"
import path from "node:path"
import { Log_Prefix, Plugin_Path } from "./constants/path.js"

const version = "1.0.0"
logger.info(chalk.rgb(76, 175, 80)("-------------------------"))
logger.info(chalk.rgb(76, 175, 80)(`入群验证插件 v${version} 初始化~`))
logger.info(chalk.rgb(76, 175, 80)("-------------------------"))

/** 递归收集目录下的 .js 文件（跳过 _ 前缀与 common.js 之类的公共模块） */
function collect(dir, { skip = [] } = {}) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collect(full, { skip }))
    } else if (entry.name.endsWith(".js") && !entry.name.startsWith("_")) {
      if (skip.includes(entry.name)) continue
      out.push(full)
    }
  }
  return out
}

/** 加载事件监听（apps/events 下的文件自己注册 Bot.on） */
for (const file of collect(`${Plugin_Path}/apps/events`)) {
  const rel = path.relative(`${Plugin_Path}/apps/events`, file)
  try {
    await import(`./apps/events/${rel}`)
    logger.debug(`${Log_Prefix} 加载事件监听：${rel}`)
  } catch (error) {
    logger.error(`${Log_Prefix} 加载事件监听失败：${rel}`)
    logger.error(error)
  }
}

/** 加载命令插件：apps 下除 events 外的所有模块 */
const apps = {}
const appFiles = collect(`${Plugin_Path}/apps`, { skip: ["common.js"] })
  .filter(f => !f.includes(`${path.sep}events${path.sep}`))

const results = await Promise.allSettled(
  appFiles.map(async file => {
    const rel = path.relative(`${Plugin_Path}/apps`, file).replace(/\\/g, "/")
    return { rel, module: await import(`./apps/${rel}`) }
  })
)

for (const r of results) {
  if (r.status === "fulfilled") {
    const { rel, module } = r.value
    const name = rel.replace(/\.js$/, "")
    const exported = module.default || Object.values(module).find(v => typeof v === "function")
    if (exported) apps[name] = exported
    logger.debug(`${Log_Prefix} 加载命令模块：${rel}`)
  } else {
    logger.error(`${Log_Prefix} 加载命令模块失败`)
    logger.error(r.reason)
  }
}

logger.info(chalk.rgb(76, 175, 80)(`入群验证插件已加载 ${Object.keys(apps).length} 个命令模块`))

export { apps }
