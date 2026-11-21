import moment from "moment"
import { Config, DataStore, Log_Prefix } from "#join-verify.components"

/**
 * 判断是否为合法 11 位大陆手机号。
 * 用于 API 异常时决定是否记录该申请人的手机号。
 */
function isValidPhone(phone) {
  if (!phone) return false
  return /^1[3-9]\d{9}$/.test(String(phone).trim())
}

class Notification {
  async sendApprovalNotice(e, result, phone) {
    const notificationGroup = Config.getConfig("config").notificationGroup
    if (!notificationGroup) return

    const applyCount = DataStore.getApplyCount(e.group_id, e.user_id)
    const groupName = e.group_name || "未知群"

    const locationStr = result.location 
        ? `${result.location.province} ${result.location.city} ${result.location.district || ""}`.trim()
        : "未知"
        
    const msg = [
      `入群申请通过\n\n`,
      `申请群聊：${groupName}(${e.group_id})\n`,
      `验证模式：${result.mode === "phone" ? "手机号验证" : "全部验证"}\n`,
      `用户昵称：${e.nickname || "未知"}\n`,
      `用户QQ：${e.user_id}\n`,
      `用户手机号：${phone || "未填写"}\n`,
      `用户id：${result.mode === "phone" ? "未记录(手机号验证模式)" : (result.userId || "未填写")}\n`,
      `手机号归属地：${locationStr}\n`,
      `申请时间：${moment(result.applyTime).format("YYYY-MM-DD HH:mm:ss")}\n`,
      `通过时间：${moment(Date.now()).format("YYYY-MM-DD HH:mm:ss")}\n`,
      `申请次数：${applyCount}\n`,
      `答案：${result.comment || "无"}\n`,
      `手机号：${result.phoneResult || "未填写"}\n`,
      `id：${result.idResult || "未填写"}`
    ]

    try {
      await Bot.pickGroup(notificationGroup).sendMsg(msg)
    } catch (error) {
      logger.error(`${Log_Prefix} 发送入群通过通知失败:`, error)
    }
  }

  async sendRejectionNotice(e, result, phone) {
    const notificationGroup = Config.getConfig("config").notificationGroup
    if (!notificationGroup) return

    const applyCount = DataStore.getApplyCount(e.group_id, e.user_id)
    const groupName = e.group_name || "未知群"

    const locationStr = result.location 
        ? `${result.location.province} ${result.location.city} ${result.location.district || ""}`.trim()
        : "未知"
        
    const msg = [
      `入群申请未通过\n\n`,
      `申请群聊：${groupName}(${e.group_id})\n`,
      `用户昵称：${e.nickname || "未知"}\n`,
      `用户QQ：${e.user_id}\n`,
      `拒绝理由：${result.reason}\n`,
      `手机号归属地：${locationStr}\n`,
      `申请时间：${moment(result.applyTime).format("YYYY-MM-DD HH:mm:ss")}\n`,
      `拒绝时间：${moment(Date.now()).format("YYYY-MM-DD HH:mm:ss")}\n`,
      `用户申请次数：${applyCount}\n`,
      `是否拉黑：${result.isBlacklisted ? "是" : "否"}\n`,
      `答案：${result.comment || "无"}\n`,
      `手机号：${result.phoneResult || "未填写"}\n`,
      `id：${result.idResult || "未填写"}`
    ]

    try {
      await Bot.pickGroup(notificationGroup).sendMsg(msg)
    } catch (error) {
      logger.error(`${Log_Prefix} 发送入群拒绝通知失败:`, error)
    }
  }

  /**
   * API 全部不可用时，推送人工验证通知。
   * 文案按用户指定格式：昵称 / QQ / 申请内容 / 申请群聊，末尾附带手机号记录结果。
   */
  async sendApiFailureNotice(result, phone) {
    const notificationGroup = Config.getConfig("config").notificationGroup
    if (!notificationGroup) {
      logger.warn(`${Log_Prefix} [人工验证] 未配置通知群，无法推送，用户 ${result?.nickname || ""} 需手动处理`)
      return
    }

    const e = result?.e || {}
    const nickname = e.nickname || result?.nickname || "未知"
    const qq = e.user_id ?? result?.qq ?? "未知"
    const comment = result?.comment || e.comment || "无"
    const groupName = e.group_name || "未知"
    const groupId = e.group_id || ""

    const phoneOk = isValidPhone(phone)
    const tail = phoneOk
      ? "已记录本次申请人及手机号，请手动通过"
      : "非手机号或错误，本次忽略未记录"

    const msg = [
      "API均出现问题，无法正常通过，请手动进行验证，用户信息：\n",
      `昵称: ${nickname}\n`,
      `QQ: ${qq}\n`,
      `申请内容: ${comment}\n`,
      `申请群聊: ${groupName}${groupId ? `(${groupId})` : ""}\n`,
      tail
    ]

    try {
      await Bot.pickGroup(notificationGroup).sendMsg(msg)
      logger.info(`${Log_Prefix} [人工验证] 已推送通知，QQ ${qq}，手机号有效: ${phoneOk}`)
    } catch (error) {
      logger.error(`${Log_Prefix} [人工验证] 通知推送失败: ${error.message}`)
    }
  }

  async sendApiCheckResult(results) {
    const notificationGroup = Config.getConfig("config").notificationGroup
    if (!notificationGroup) return

    const availableCount = results.filter(r => r.available).length
    const totalCount = results.length

    let msg = `API巡检结果\n\n`
    msg += `总接口数：${totalCount}\n`
    msg += `可用接口：${availableCount}\n`
    msg += `不可用接口：${totalCount - availableCount}\n\n`

    results.forEach(result => {
      msg += `${result.available ? "可用" : "不可用"} ${result.url}\n`
      msg += `   延迟：${result.latency}ms\n`
    })

    try {
      await Bot.pickGroup(notificationGroup).sendMsg(msg)
    } catch (error) {
      logger.error(`${Log_Prefix} 发送API巡检结果失败:`, error)
    }
  }
}

export default new Notification()
