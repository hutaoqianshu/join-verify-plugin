import { DataStore, Log_Prefix } from "#join-verify.components"

Bot.on?.("notice", async (e) => {
  if (e.notice_type !== "group") return

  const groupId = String(e.group_id)
  const groupRule = DataStore.getGroupRule(groupId)

  if (!groupId || groupRule === "none") return

  const subType = e.sub_type
  const userId = String(e.user_id)

  const isDecrease = subType === "decrease" || subType === "leave" || subType === "kick" || subType === "group_leave" || subType === "group_kick"
  if (!isDecrease) return

  const operatorId = e.operator_id ? String(e.operator_id) : null
  const isKicked = subType === "kick" || subType === "group_kick" || (operatorId && operatorId !== userId)

  if (!isKicked) {
    if (groupRule === "verify" || groupRule === "reject") {
      logger.info(`${Log_Prefix} [退群事件] 用户 ${userId} 退出群 ${groupId}，群规则: ${groupRule}`)
      DataStore.addLeaveUser(userId, groupId)
      logger.info(`${Log_Prefix} [退群用户标记] 用户 ${userId} 已标记为退群用户`)
    }
  } else {
    logger.info(`${Log_Prefix} [踢人事件] 用户 ${userId} 被踢出群 ${groupId}，群规则: ${groupRule}`)

    if (groupRule === "verify") {
      const success = DataStore.addRedUser(userId)
      if (success) {
        logger.info(`${Log_Prefix} [红用户标记] 用户 ${userId} 因被踢出验证群已标记为红用户`)
      } else {
        logger.info(`${Log_Prefix} [红用户标记] 用户 ${userId} 已是红用户`)
      }
    }

    if (groupRule === "verify" || groupRule === "reject") {
      DataStore.addLeaveUser(userId, groupId)
      logger.info(`${Log_Prefix} [退群用户标记] 用户 ${userId} 已标记为退群用户`)
    }
  }
})