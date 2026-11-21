import YAML from "yaml"
import chokidar from "chokidar"
import fs from "node:fs"
import _ from "lodash"
import { Plugin_Path, Log_Prefix, Path } from "../constants/path.js"
import cfg from "../../../lib/config/config.js"

class Config {
  constructor() {
    this.config = {}
    this.watcher = { config: {}, defSet: {} }
    this.initCfg()
  }

  initCfg() {
    const path = `${Plugin_Path}/config/config/`
    const pathDef = `${Plugin_Path}/config/default_config/`
    
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true })
    }

    const files = fs.readdirSync(pathDef).filter(file => file.endsWith(".yaml"))
    for (let file of files) {
      if (!fs.existsSync(`${path}${file}`)) {
        fs.copyFileSync(`${pathDef}${file}`, `${path}${file}`)
      }
      this.watch(`${path}${file}`, file.replace(".yaml", ""), "config")
    }
  }

  getConfig(name) {
    return this.getYaml("config", name)
  }

  getDefConfig(name) {
    return this.getYaml("default_config", name)
  }

  getYaml(type, name) {
    const file = `${Plugin_Path}/config/${type}/${name}.yaml`
    const key = `${type}.${name}`

    if (this.config[key]) return this.config[key]

    try {
      this.config[key] = YAML.parse(fs.readFileSync(file, "utf8")) || {}
    } catch (e) {
      logger.error(`${Log_Prefix} 读取配置文件失败: ${file}`)
      logger.error(e)
      this.config[key] = {}
    }

    this.watch(file, name, type)
    return this.config[key]
  }

  watch(file, name, type = "config") {
    const key = `${type}.${name}`
    if (this.watcher[key]) return

    const watcher = chokidar.watch(file)
    watcher.on("change", () => {
      delete this.config[key]
      logger.mark(`${Log_Prefix} 配置文件已更新: ${name}`)
    })
    this.watcher[key] = watcher
  }

  modify(name, key, value, type = "config") {
    const path = `${Plugin_Path}/config/${type}/${name}.yaml`
    const data = this.getYaml(type, name)
    _.set(data, key, value)
    fs.writeFileSync(path, YAML.stringify(data, { indent: 2 }), "utf8")
    delete this.config[`${type}.${name}`]
    return true
  }

  get masterQQ() {
    return cfg.masterQQ
  }

  get master() {
    return cfg.master
  }
}

export default new Config()
