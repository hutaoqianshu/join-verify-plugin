import moment from "moment"
import { Log_Prefix } from "#join-verify.components"
import { ApiManager, ApiProbe } from "#join-verify.model"
import { VerifyBase } from "./common.js"

/**
 * 手机号查询 API 管理
 * 命令：#新增查询api / #删除查询api / #查询API列表 / #测试api
 */
export class ApiConfig extends VerifyBase {
  constructor() {
    super({
      name: "入群验证-API管理",
      rule: [
        { reg: "^#新增查询api\\s+(.+)$", fnc: "addApi" },
        { reg: "^#删除查询api\\s+(.+)$", fnc: "removeApi" },
        { reg: "^#查询API列表$", fnc: "queryApiList" },
        { reg: "^#测试api$", fnc: "testApi" }
      ]
    })
  }

  async addApi(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #新增查询api 命令`)
    if (!await this.checkPermission(e, "master")) return

    const url = e.msg.match(/^#新增查询api\s+(.+)$/)?.[1].trim()
    if (!url) return e.reply("请输入API地址")

    e.reply("正在验证api~")
    const result = await ApiManager.addApi(url)
    e.reply(result.message)
    if (result.success) logger.info(`${Log_Prefix} [命令执行] #新增查询api 成功，API: ${url}`)
    else logger.warn(`${Log_Prefix} [命令执行] #新增查询api 失败，API: ${url}`)
  }

  async removeApi(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #删除查询api 命令`)
    if (!await this.checkPermission(e, "master")) return

    const url = e.msg.match(/^#删除查询api\s+(.+)$/)?.[1].trim()
    if (!url) return e.reply("请输入API地址")

    const success = await ApiManager.removeApi(url)
    e.reply(success ? "API删除成功" : "API不存在")
    if (success) logger.info(`${Log_Prefix} [命令执行] #删除查询api 成功，API: ${url}`)
  }

  async queryApiList(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #查询API列表 命令`)
    if (!await this.checkPermission(e, "master")) return

    const apiList = ApiManager.getApiList()
    if (apiList.length === 0) return e.reply("暂无API接口，请使用 #新增查询api 添加")

    let msg = `API列表（共${apiList.length}个）\n\n`
    apiList.forEach((api, index) => {
      msg += `${index + 1}. ${api.url}\n`
      msg += `   状态：${api.available ? "可用" : "不可用"}\n`
      msg += `   延迟：${api.latency}ms\n`
      msg += `   最后检测：${moment(api.lastCheckTime).format("YYYY-MM-DD HH:mm:ss")}\n\n`
    })

    e.reply(msg)
    logger.info(`${Log_Prefix} [命令执行] #查询API列表 成功，共${apiList.length}个接口`)
  }

  async testApi(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #测试api 命令`)
    if (!await this.checkPermission(e, "master")) return

    const apiList = ApiManager.getApiList()
    if (apiList.length === 0) return e.reply("暂无API接口")

    e.reply(`正在测试${apiList.length}个接口，请稍候...`)
    const results = await ApiManager.checkAllApis()

    let msg = `API测试结果\n\n`
    results.forEach((r, i) => {
      msg += `${i + 1}. ${r.url}\n`
      msg += `   ${r.available ? "可用" : "不可用"}，延迟：${r.latency}ms\n`
    })

    e.reply(msg)
    logger.info(`${Log_Prefix} [命令执行] #测试api 完成`)
  }
}

export default ApiConfig
