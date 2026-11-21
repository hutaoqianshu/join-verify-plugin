import moment from "moment"
import { Config, DataStore, Log_Prefix } from "#join-verify.components"
import { VerifyBase } from "./common.js"

/** 退群用户策略的额外白名单管理员，可在 config 中配置 leaveUserAdminQQ */
const getLeaveAdmin = () => String(Config.getConfig("config").leaveUserAdminQQ || "")

/**
 * 退群用户管理
 * 命令：#查看退群用户 [页码] / #设置退群用户策略 / #移除退群用户
 */
export class LeaveUser extends VerifyBase {
  constructor() {
    super({
      name: "入群验证-退群用户",
      rule: [
        { reg: "^#查看退群用户(?:\\s+(\\d+))?$", fnc: "showLeaveUsers" },
        { reg: "^#设置退群用户策略\\s+(\\d+)\\s+(验证|拒绝)$", fnc: "setLeaveUserPolicy" },
        { reg: "^#移除退群用户\\s+(.+)$", fnc: "removeLeaveUserCmd" }
      ]
    })
  }

  /**
   * 分页展示退群用户。
   * 671 人全量拼接约 72KB、3358 行，会超出 QQ 单条消息上限导致发送失败。
   */
  async showLeaveUsers(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #查看退群用户 命令`)
    if (!await this.checkPermission(e, "master")) return

    const leaveUsers = DataStore.getLeaveUsers()
    const keys = Object.keys(leaveUsers)
    if (keys.length === 0) return e.reply("暂无退群用户")

    const pageSize = 20
    const page = Math.max(1, parseInt(e.msg.match(/\s(\d+)$/)?.[1] || "1", 10))
    const totalPages = Math.ceil(keys.length / pageSize)
    const start = (page - 1) * pageSize
    const pageKeys = keys.slice(start, start + pageSize)

    if (pageKeys.length === 0) return e.reply(`页码超出范围，共 ${totalPages} 页`)

    let msg = `退群用户列表（共${keys.length}人，第${page}/${totalPages}页）\n\n`
    pageKeys.forEach((qq, index) => {
      const user = leaveUsers[qq]
      const policyText = user.policy === "verify" ? "正常验证" : "拒绝"
      msg += `${start + index + 1}. QQ: ${qq} [${policyText}]\n`
      msg += `   群：${(user.groups || []).join(", ")}\n`
      msg += `   退群时间：${moment(user.leaveTime).format("YYYY-MM-DD HH:mm")}\n`
    })
    msg += `\n发送 #查看退群用户 页码 翻页`

    e.reply(msg)
    logger.info(`${Log_Prefix} [命令执行] #查看退群用户 成功，共${keys.length}人，第${page}/${totalPages}页`)
  }

  async setLeaveUserPolicy(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #设置退群用户策略 命令`)
    if (!await this.checkPermission(e, "master") && String(e.user_id) !== getLeaveAdmin()) return

    const match = e.msg.match(/^#设置退群用户策略\s+(\d+)\s+(验证|拒绝)$/)
    if (!match) return e.reply("格式错误，请使用：#设置退群用户策略 QQ号 验证/拒绝")

    const qq = match[1]
    const policy = match[2] === "验证" ? "verify" : "reject"

    const success = DataStore.setLeaveUserPolicy(qq, policy)
    if (!success) return e.reply(`QQ ${qq} 不是退群用户，无需设置策略`)

    const policyText = policy === "verify" ? "正常验证" : "拒绝"
    e.reply(`已将QQ ${qq} 的二次入群策略设置为：${policyText}`)
    logger.info(`${Log_Prefix} [命令执行] #设置退群用户策略 成功，QQ: ${qq}，策略: ${policyText}`)
  }

  async removeLeaveUserCmd(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #移除退群用户 命令`)
    if (!await this.checkPermission(e, "master") && String(e.user_id) !== getLeaveAdmin()) return

    const qq = this.extractQQ(e)
    if (!qq) return e.reply("请输入QQ号或@用户")

    const success = DataStore.removeLeaveUser(qq)
    e.reply(success ? `已将 ${qq} 从退群用户中移除` : `${qq} 不是退群用户`)
    if (success) logger.info(`${Log_Prefix} [命令执行] #移除退群用户 成功，QQ: ${qq}`)
  }
}

export default LeaveUser
