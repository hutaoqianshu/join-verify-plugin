import { DataStore, Log_Prefix } from "#join-verify.components"

/**
 * 入群验证插件的命令基类。
 * 提供权限校验、QQ 号提取、群名兜底等公共能力。
 */
export class VerifyBase extends plugin {
  constructor(data = {}) {
    super({
      name: data.name || "入群验证",
      event: "message",
      priority: 1,
      rule: data.rule || []
    })
  }

  get Bot() {
    return this.e.bot ?? Bot
  }

  /**
   * 权限校验。默认仅主人（master）可用。
   * @returns {boolean} 通过为 true，不通过会直接回复并返回 false
   */
  async checkPermission(e, permission = "master") {
    if (permission === "master") {
      if (!e.isMaster) {
        logger.warn(`${Log_Prefix} [权限检查] 用户 ${e.user_id} 无主人权限，拒绝执行命令`)
        e.reply("该命令仅限主人可用")
        return false
      }
    } else if (permission === "admin") {
      if (!e.isMaster && (!e.group?.is_admin && !e.group?.is_owner)) {
        logger.warn(`${Log_Prefix} [权限检查] 用户 ${e.user_id} 无管理员权限，拒绝执行命令`)
        e.reply("该命令仅限管理员可用")
        return false
      }
    }
    return true
  }

  /**
   * 从消息里提取目标 QQ：优先 @，其次第一个 5-11 位数字。
   * @returns {string|null}
   */
  extractQQ(e) {
    const at = e.message?.find(item => item.type === "at")
    if (at && at.qq) return String(at.qq)

    const match = e.msg.match(/(\d{5,11})/)
    if (match) return match[1]

    return null
  }

  /**
   * 取群名，失败时退回群号，避免显示"未知群"。
   */
  async fetchGroupName(groupId) {
    try {
      const group = Bot.pickGroup?.(groupId)
      if (group?.getInfo) {
        const info = await group.getInfo()
        const name = info?.group_name || info?.name
        if (name) return name
      }
    } catch (err) {
      logger.warn(`${Log_Prefix} [群名获取] 群 ${groupId} 获取群名失败: ${err.message}`)
    }
    return String(groupId)
  }
}

export default VerifyBase
