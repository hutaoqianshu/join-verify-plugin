import { Config, DataStore, Log_Prefix } from "#join-verify.components"
import { VerifyBase } from "./common.js"

/**
 * 红用户与限时黑名单
 * 命令：#新增/删除红用户、#新增/删除黑名单、#设置黑名单阈值/时间、#拉黑开启/关闭
 */
export class Blacklist extends VerifyBase {
  constructor() {
    super({
      name: "入群验证-黑白名单",
      rule: [
        { reg: "^#新增红用户\\s+(.+)$", fnc: "addRedUser" },
        { reg: "^#删除红用户\\s+(.+)$", fnc: "removeRedUser" },
        { reg: "^#新增黑名单\\s+(.+)$", fnc: "addBlacklist" },
        { reg: "^#删除黑名单\\s+(.+)$", fnc: "removeBlacklist" },
        { reg: "^#设置黑名单阈值\\s+(\\d+)$", fnc: "setBlacklistThreshold" },
        { reg: "^#设置黑名单时间\\s+(\\d+)$", fnc: "setBlacklistDuration" },
        { reg: "^#拉黑(开启|关闭)$", fnc: "toggleBlacklist" }
      ]
    })
  }

  async addRedUser(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #新增红用户 命令`)
    if (!await this.checkPermission(e, "master")) return

    const qq = this.extractQQ(e)
    if (!qq) {
      logger.warn(`${Log_Prefix} [命令执行] #新增红用户 缺少QQ参数`)
      return e.reply("请输入QQ号或@用户")
    }

    const success = DataStore.addRedUser(qq)
    e.reply(success ? `已将 ${qq} 增加为红用户` : `${qq} 已是红用户`)
    if (success) logger.info(`${Log_Prefix} [命令执行] #新增红用户 成功，QQ: ${qq}`)
    else logger.warn(`${Log_Prefix} [命令执行] #新增红用户 失败，QQ已是红用户: ${qq}`)
  }

  async removeRedUser(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #删除红用户 命令`)
    if (!await this.checkPermission(e, "master")) return

    const qq = this.extractQQ(e)
    if (!qq) {
      logger.warn(`${Log_Prefix} [命令执行] #删除红用户 缺少QQ参数`)
      return e.reply("请输入QQ号或@用户")
    }

    const success = DataStore.removeRedUser(qq)
    e.reply(success ? `已将 ${qq} 从红用户中移除` : `${qq} 不是红用户`)
    if (success) logger.info(`${Log_Prefix} [命令执行] #删除红用户 成功，QQ: ${qq}`)
    else logger.warn(`${Log_Prefix} [命令执行] #删除红用户 失败，QQ不是红用户: ${qq}`)
  }

  async addBlacklist(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 在群 ${e.group_id} 执行 #新增黑名单 命令`)
    if (!await this.checkPermission(e, "master")) return

    const qq = this.extractQQ(e)
    if (!qq) {
      logger.warn(`${Log_Prefix} [命令执行] #新增黑名单 缺少QQ参数`)
      return e.reply("请输入QQ号或@用户")
    }

    const duration = Config.getConfig("config").blacklistDuration || 3600
    DataStore.addToBlacklist(e.group_id, qq, duration)
    e.reply(`已将 ${qq} 加入本群限时黑名单 ${duration} 秒`)
    logger.info(`${Log_Prefix} [命令执行] #新增黑名单 成功，QQ: ${qq}，时长: ${duration}秒`)
  }

  async removeBlacklist(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 在群 ${e.group_id} 执行 #删除黑名单 命令`)
    if (!await this.checkPermission(e, "master")) return

    const qq = this.extractQQ(e)
    if (!qq) {
      logger.warn(`${Log_Prefix} [命令执行] #删除黑名单 缺少QQ参数`)
      return e.reply("请输入QQ号或@用户")
    }

    const success = DataStore.removeFromBlacklist(e.group_id, qq)
    e.reply(success ? `已将 ${qq} 移出本群限时黑名单` : `${qq} 不在本群限时黑名单中`)
    if (success) logger.info(`${Log_Prefix} [命令执行] #删除黑名单 成功，QQ: ${qq}`)
  }

  async setBlacklistThreshold(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #设置黑名单阈值 命令`)
    if (!await this.checkPermission(e, "master")) return

    const threshold = parseInt(e.msg.match(/^#设置黑名单阈值\s+(\d+)$/)?.[1])
    if (!threshold || threshold < 1) return e.reply("请输入正确的阈值(正整数)")

    Config.modify("config", "blacklistThreshold", threshold)
    e.reply(`已将黑名单阈值设置为: ${threshold}次`)
    logger.info(`${Log_Prefix} [命令执行] #设置黑名单阈值 成功，阈值: ${threshold}`)
  }

  async setBlacklistDuration(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #设置黑名单时间 命令`)
    if (!await this.checkPermission(e, "master")) return

    const duration = parseInt(e.msg.match(/^#设置黑名单时间\s+(\d+)$/)?.[1])
    if (!duration || duration < 1) return e.reply("请输入正确的时长(秒)")

    Config.modify("config", "blacklistDuration", duration)
    e.reply(`已将黑名单时长设置为: ${duration}秒`)
    logger.info(`${Log_Prefix} [命令执行] #设置黑名单时间 成功，时长: ${duration}秒`)
  }

  async toggleBlacklist(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #拉黑开关 命令`)
    if (!await this.checkPermission(e, "master")) return

    const enable = e.msg.includes("开启")
    Config.modify("config", "blacklistEnabled", enable)
    e.reply(`已${enable ? "开启" : "关闭"}自动拉黑功能`)
    logger.info(`${Log_Prefix} [命令执行] #拉黑${enable ? "开启" : "关闭"} 成功`)
  }
}

export default Blacklist
