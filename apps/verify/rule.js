import { Config, DataStore, Log_Prefix } from "#join-verify.components"
import { VerifyBase } from "./common.js"

/**
 * 群规则与导流配置
 * 命令：#开启入群审核 / #开启手机号验证 / #关闭入群审核 / #设置入群规则 / #设置导流
 */
export class GroupRule extends VerifyBase {
  constructor() {
    super({
      name: "入群验证-群规则",
      rule: [
        { reg: "^#开启入群审核$", fnc: "enableVerifyGroup" },
        { reg: "^#开启手机号验证$", fnc: "enablePhoneVerifyGroup" },
        { reg: "^#关闭入群审核$", fnc: "disableVerifyGroup" },
        { reg: "^#设置入群规则(?:\\s*)(\\d+)(?:\\s*)(拒绝|手机号验证|全部验证)$", fnc: "setGroupRule" },
        { reg: "^#设置导流(?:\\s*)(\\d+)(?:\\s*)群(?:\\s*)群号(?:\\s*)(\\d+)$", fnc: "setDiversion" }
      ]
    })
  }

  async enableVerifyGroup(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #开启入群审核 命令`)
    if (!await this.checkPermission(e, "master")) return

    const groupId = String(e.group_id)
    const currentRule = DataStore.getGroupRule(groupId)

    if (currentRule === "verify") {
      logger.warn(`${Log_Prefix} [命令执行] #开启入群审核 失败，群 ${groupId} 已开启全部验证`)
      return e.reply("本群已开启入群审核(全部验证)，如需切换为手机号验证请使用 #开启手机号验证")
    }

    DataStore.setGroupRule(groupId, "verify")
    e.reply(`已开启群 ${groupId} 的入群审核(全部验证：手机号+ID)`)
    logger.info(`${Log_Prefix} [命令执行] #开启入群审核 成功，群号: ${groupId}`)
  }

  async enablePhoneVerifyGroup(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #开启手机号验证 命令`)
    if (!await this.checkPermission(e, "master")) return

    const groupId = String(e.group_id)
    const currentRule = DataStore.getGroupRule(groupId)

    if (currentRule === "phone_verify") {
      return e.reply("本群已开启手机号验证")
    }

    DataStore.setGroupRule(groupId, "phone_verify")
    e.reply(`已开启群 ${groupId} 的手机号验证(仅验证手机号)`)
    logger.info(`${Log_Prefix} [命令执行] #开启手机号验证 成功，群号: ${groupId}`)
  }

  async disableVerifyGroup(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #关闭入群审核 命令`)
    if (!await this.checkPermission(e, "master")) return

    const groupId = String(e.group_id)
    if (DataStore.getGroupRule(groupId) === "none") {
      return e.reply("本群未开启入群审核")
    }

    DataStore.removeGroupRule(groupId)
    e.reply(`已关闭群 ${groupId} 的入群审核`)
    logger.info(`${Log_Prefix} [命令执行] #关闭入群审核 成功，群号: ${groupId}`)
  }

  async setGroupRule(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #设置入群规则 命令`)
    if (!await this.checkPermission(e, "master")) return

    const match = e.msg.match(/^#设置入群规则\s*(\d+)\s*(拒绝|手机号验证|全部验证)$/)
    if (!match) {
      return e.reply("格式错误，请使用：#设置入群规则 群号 拒绝/手机号验证/全部验证")
    }

    const groupId = match[1]
    const ruleText = match[2]
    const ruleMap = { "拒绝": "reject", "手机号验证": "phone_verify", "全部验证": "verify" }

    DataStore.setGroupRule(groupId, ruleMap[ruleText])
    e.reply(`已设置群 ${groupId} 的入群规则为：${ruleText}`)
    logger.info(`${Log_Prefix} [命令执行] #设置入群规则 成功，群: ${groupId}，规则: ${ruleText}`)
  }

  /**
   * #设置导流x群群号+qq群号
   * 导流目标全局只有一个，改完立即影响所有 reject 群的拒绝理由。
   * 正则用 \\s* 而非 \\s+，命令中间加不加空格都能触发。
   */
  async setDiversion(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #设置导流 命令`)
    if (!await this.checkPermission(e, "master")) return

    const match = e.msg.match(/^#设置导流\s*(\d+)\s*群\s*群号\s*(\d+)$/)
    if (!match) {
      return e.reply("格式错误，请使用：#设置导流8群群号123456789（中间可不加空格）")
    }

    const index = match[1]
    const groupId = match[2]

    Config.modify("config", "diversionEnabled", true)
    Config.modify("config", "diversionIndex", index)
    Config.modify("config", "diversionGroupId", groupId)

    const reason = DataStore.getDiversionReason()
    e.reply(`已设置导流目标：${index}群 ${groupId}\n拒绝理由将变为：${reason}`)
    logger.info(`${Log_Prefix} [命令执行] #设置导流 成功，${index}群 ${groupId}，文案: ${reason}`)
  }
}

export default GroupRule
