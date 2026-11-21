import { Config, DataStore, Log_Prefix } from "#join-verify.components"
import { VerifyPipeline, Notification } from "#join-verify.model"
import moment from "moment"

/**
 * 处理入群申请（同意 / 拒绝）
 * 关键点：拒绝理由必须原样传到协议层，所以优先走 processRequest(seq, operate, reason)，
 * e.approve 只作为兜底（部分适配器实现只接收布尔值，理由会被丢弃）
 */
// 拒绝前等待毫秒数：秒拒可能被 QQ 判定为自动拒绝而不向申请方推送通知
const REJECT_DELAY_MS = 3000

async function handleJoinRequest(e, approve, reason = "") {
  const bot = e.bot ?? Bot
  const seq = e.seq ?? e.flag
  const group = typeof bot?.pickGroup === "function" ? bot.pickGroup(e.group_id) : null
  const errors = []
  // 强制布尔：协议层要求 approve 是 boolean。
  // 此前把 e.sub_type("add") 传进了 approve 的位置，非空字符串为真值，会把拒绝变成同意。
  approve = approve === true

  if (!approve && REJECT_DELAY_MS > 0) {
    logger.info(`${Log_Prefix} [申请处理] 拒绝前等待 ${REJECT_DELAY_MS}ms，避免秒拒导致申请方收不到通知`)
    await new Promise(resolve => setTimeout(resolve, REJECT_DELAY_MS))
  }

  // 1. OneBot 标准接口：set_group_add_request（reason 为官方支持字段，会推送给申请方）
  const flag = e.flag ?? seq
  if (flag !== undefined && flag !== null && flag !== "") {
    const oneBotParams = { flag: String(flag), sub_type: e.sub_type, approve, reason }
    const senders = []

    if (typeof bot?.sendApi === "function") {
      senders.push({ name: "bot.sendApi", call: () => bot.sendApi("set_group_add_request", oneBotParams) })
    }
    if (typeof bot?.internal?.sendApi === "function") {
      senders.push({ name: "bot.internal.sendApi", call: () => bot.internal.sendApi("set_group_add_request", oneBotParams) })
    }
    // 适配器方法已 bind 了 data，剩余签名为 (flag, approve, reason, sub_type)
    if (typeof bot?.setGroupAddRequest === "function") {
      senders.push({ name: "bot.setGroupAddRequest", call: () => bot.setGroupAddRequest(flag, approve, reason, e.sub_type) })
    }

    for (const { name, call } of senders) {
      try {
        const res = await call()
        if (res && res.status && res.status !== "ok") {
          throw new Error(`status=${res.status} retcode=${res.retcode} ${res.wording || ""}`)
        }
        logger.info(`${Log_Prefix} [申请处理] ${name} → set_group_add_request 成功，flag=${flag} approve=${approve}，理由: ${reason || "无"}`)
        return
      } catch (err) {
        errors.push(`${name}: ${err.message}`)
        logger.warn(`${Log_Prefix} [申请处理] ${name} 失败：${err.message}`)
      }
    }
  }

  // 2. icqq：group.processRequest(seq, approve, reason)
  if (seq !== undefined && seq !== null && seq !== "" && typeof group?.processRequest === "function") {
    try {
      await group.processRequest(seq, approve, reason)
      logger.info(`${Log_Prefix} [申请处理] processRequest(seq=${seq} 类型=${typeof seq}, approve=${approve}) 调用成功，理由: ${reason || "无"}`)
      return
    } catch (err) {
      errors.push(`processRequest: ${err.message}`)
      logger.warn(`${Log_Prefix} [申请处理] processRequest 失败：${err.message}`)
    }
  } else {
    const botKeys = Object.keys(bot || {}).filter(k => /api|request|adapter|internal|onebot/i.test(k))
    logger.warn(`${Log_Prefix} [适配器探测] sendApi=${typeof bot?.sendApi} internal=${typeof bot?.internal} setGroupAddRequest=${typeof bot?.setGroupAddRequest} set_group_add_request=${typeof bot?.set_group_add_request} processRequest=${typeof group?.processRequest} e.approve=${typeof e.approve} e.reject=${typeof e.reject} 相关键=${botKeys.join(",") || "无"}`)
  }

  // 3. 框架封装：e.approve / e.reject
  if (typeof e.approve === "function") {
    try {
      await e.approve(approve, reason)
      logger.warn(`${Log_Prefix} [申请处理] 退回 e.approve(${approve}) 成功。注意：该接口多数实现只接收布尔值，拒绝理由会被丢弃，申请方可能收不到通知`)
      return
    } catch (err) {
      errors.push(`e.approve: ${err.message}`)
      logger.warn(`${Log_Prefix} [申请处理] e.approve 失败：${err.message}`)
    }
  }

  if (!approve && typeof e.reject === "function") {
    try {
      await e.reject(reason)
      logger.info(`${Log_Prefix} [申请处理] 调用 e.reject 成功，理由: ${reason || "无"}`)
      return
    } catch (err) {
      errors.push(`e.reject: ${err.message}`)
    }
  }

  throw new Error(`无法处理入群申请（seq=${seq ?? "空"} flag=${e.flag ?? "空"}）：${errors.join("; ") || "所有接口均不可用"}`)
}

Bot.on?.("request", async (e) => {
  if (e.request_type !== "group" || e.sub_type !== "add") return

  const groupIdStr = String(e.group_id)
  const groupRule = DataStore.getGroupRule(groupIdStr)

  if (groupRule === "none") {
    logger.info(`${Log_Prefix} [跳过] 群 ${e.group_id} 未设置入群规则，默认不处理`)
    return
  }

  const applyTime = Date.now()

  logger.info(`${Log_Prefix} [开始处理] 用户 ${e.user_id}(${e.nickname}) 申请加入群 ${e.group_id}(${e.group_name})`)
  logger.info(`${Log_Prefix} [申请信息] 申请备注: ${e.comment || '无'}，群规则: ${groupRule}`)
  logger.info(`${Log_Prefix} [事件字段] seq=${e.seq ?? "空"} flag=${e.flag ?? "空"} request_type=${e.request_type} sub_type=${e.sub_type}`)

  if (groupRule === "reject") {
    try {
      const rejectReason = DataStore.getDiversionReason()

      await handleJoinRequest(e, false, rejectReason)

      DataStore.addAuditLog({
        groupId: e.group_id,
        groupName: e.group_name,
        qq: e.user_id,
        nickname: e.nickname,
        phone: "",
        userId: "",
        comment: e.comment || "",
        phoneResult: "未校验",
        idResult: "未校验",
        applyTime,
        rejectTime: Date.now(),
        status: "rejected",
        reason: rejectReason,
        isBlacklisted: false,
        applyCount: 0
      })

      DataStore.updateStatistics(e.group_id, "rejected")

      logger.info(`${Log_Prefix} [处理完成] 用户 ${e.user_id} 入群申请处理完成，结果：拒绝(群规则拒绝)`)
    } catch (error) {
      logger.error(`${Log_Prefix} [处理失败] 用户 ${e.user_id} 入群申请拒绝失败`)
      logger.error(`${Log_Prefix} [错误详情]`, error)
    }
    return
  }

  const result = await VerifyPipeline.process(e, {
    mode: groupRule === "phone_verify" ? "phone" : "full"
  })
  result.applyTime = applyTime

  const { phone, userId } = result

  // API 异常：既不通过也不拒绝，留待人工在通知群里处理。
  // 不调用协议接口，申请会保持"待处理"状态，管理员可自行通过。
  if (result.skip) {
    logger.info(`${Log_Prefix} [转人工] 用户 ${e.user_id} 因 ${result.manualReason || "API异常"} 转人工验证，不自动处理`)
    DataStore.addAuditLog({
      groupId: e.group_id,
      groupName: e.group_name,
      qq: e.user_id,
      nickname: e.nickname,
      phone: phone || "",
      userId: userId || "",
      comment: result.comment || "",
      phoneResult: result.phoneResult || "待人工",
      idResult: result.idResult || "",
      location: "",
      applyTime,
      rejectTime: Date.now(),
      status: "manual",
      reason: "API异常，转人工验证",
      applyCount: DataStore.getApplyCount(e.group_id, e.user_id)
    })
    return
  }

  if (result.approve) {
    try {
      logger.info(`${Log_Prefix} [校验通过] 用户 ${e.user_id} 全部校验通过，准备同意入群`)

      await handleJoinRequest(e, true)

      if (phone) {
        const bindUserId = result.mode === "phone" ? "" : (userId || "")
        DataStore.saveBinding(phone, e.user_id, bindUserId)
        logger.info(`${Log_Prefix} [绑定成功] 用户 ${e.user_id} 手机号 ${phone} 已绑定${result.mode === "phone" ? "(仅手机号模式，不记录ID)" : `，ID: ${userId || '无'}`}`)
      }

      DataStore.resetApplyCount(e.group_id, e.user_id)
      logger.info(`${Log_Prefix} [计数重置] 用户 ${e.user_id} 在群 ${e.group_id} 的申请次数已重置`)

      DataStore.addAuditLog({
        groupId: e.group_id,
        groupName: e.group_name,
        qq: e.user_id,
        nickname: e.nickname,
        phone: phone || "",
        userId: userId || "",
        comment: result.comment || "",
        phoneResult: result.phoneResult || "",
        idResult: result.idResult || "",
        location: result.location ? JSON.stringify(result.location) : "",
        applyTime,
        approveTime: Date.now(),
        status: "approved",
        reason: "全部校验通过",
        applyCount: DataStore.getApplyCount(e.group_id, e.user_id)
      })
      logger.info(`${Log_Prefix} [日志记录] 审核日志已保存`)

      DataStore.updateStatistics(e.group_id, "approved")

      await Notification.sendApprovalNotice(e, result, phone)
      logger.info(`${Log_Prefix} [通知发送] 入群通过通知已发送至通知群`)

      logger.info(`${Log_Prefix} [处理完成] 用户 ${e.user_id} 入群申请处理完成，结果：通过`)
    } catch (error) {
      logger.error(`${Log_Prefix} [处理失败] 用户 ${e.user_id} 入群申请处理失败`)
      logger.error(`${Log_Prefix} [错误详情]`, error)
      DataStore.addAuditLog({
        groupId: e.group_id,
        groupName: e.group_name,
        qq: e.user_id,
        nickname: e.nickname,
        phone: phone || "",
        userId: userId || "",
        comment: result.comment || "",
        phoneResult: result.phoneResult || "",
        idResult: result.idResult || "",
        location: result.location ? JSON.stringify(result.location) : "",
        applyTime,
        rejectTime: Date.now(),
        status: "rejected",
        reason: `处理异常: ${error.message}`,
        applyCount: DataStore.getApplyCount(e.group_id, e.user_id)
      })
      DataStore.updateStatistics(e.group_id, "rejected")
    }
  } else {
    try {
      logger.info(`${Log_Prefix} [校验拒绝] 用户 ${e.user_id} 校验未通过，原因: ${result.reason}`)

      await handleJoinRequest(e, false, result.reason)

      if (result.isBlacklisted) {
        logger.info(`${Log_Prefix} [拉黑操作] 用户 ${e.user_id} 已被加入限时黑名单`)
      }

      DataStore.addAuditLog({
        groupId: e.group_id,
        groupName: e.group_name,
        qq: e.user_id,
        nickname: e.nickname,
        phone: phone || "",
        userId: userId || "",
        comment: result.comment || "",
        phoneResult: result.phoneResult || "",
        idResult: result.idResult || "",
        location: result.location ? JSON.stringify(result.location) : "",
        applyTime,
        rejectTime: Date.now(),
        status: "rejected",
        reason: result.reason,
        isBlacklisted: result.isBlacklisted,
        applyCount: DataStore.getApplyCount(e.group_id, e.user_id)
      })
      logger.info(`${Log_Prefix} [日志记录] 审核日志已保存`)

      DataStore.updateStatistics(e.group_id, result.isBlacklisted ? "blacklisted" : "rejected")

      await Notification.sendRejectionNotice(e, result, phone)
      logger.info(`${Log_Prefix} [通知发送] 入群拒绝通知已发送至通知群`)

      logger.info(`${Log_Prefix} [处理完成] 用户 ${e.user_id} 入群申请处理完成，结果：拒绝，原因: ${result.reason}`)
    } catch (error) {
      logger.error(`${Log_Prefix} [处理失败] 用户 ${e.user_id} 入群申请拒绝失败`)
      logger.error(`${Log_Prefix} [错误详情]`, error)
      DataStore.addAuditLog({
        groupId: e.group_id,
        groupName: e.group_name,
        qq: e.user_id,
        nickname: e.nickname,
        phone: phone || "",
        userId: userId || "",
        comment: result.comment || "",
        phoneResult: result.phoneResult || "",
        idResult: result.idResult || "",
        location: result.location ? JSON.stringify(result.location) : "",
        applyTime,
        rejectTime: Date.now(),
        status: "rejected",
        reason: `拒绝异常: ${error.message}`,
        applyCount: DataStore.getApplyCount(e.group_id, e.user_id)
      })
      DataStore.updateStatistics(e.group_id, "rejected")
    }
  }
})

async function cleanExpiredBlacklist() {
  const cleaned = DataStore.cleanExpiredBlacklist()
  if (cleaned) {
    logger.info(`${Log_Prefix} [定时任务] 已清理过期黑名单`)
  }
}

setInterval(cleanExpiredBlacklist, 60000)
