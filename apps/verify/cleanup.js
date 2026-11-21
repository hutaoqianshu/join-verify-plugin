import { DataStore, Log_Prefix } from "#join-verify.components"
import { VerifyBase } from "./common.js"

/**
 * 群管理与联动清退
 * 命令：#获取需管理群 / #获取所有群员 / #联动清退 / #确认清退 / #取消清退 /
 *       #测试检索清退群 / #测试撤回消息
 */
export class Cleanup extends VerifyBase {
  constructor() {
    super({
      name: "入群验证-群管理",
      rule: [
        { reg: "^#获取需管理群$", fnc: "getManagedGroups" },
        { reg: "^#获取所有群员$", fnc: "getAllGroupMembers" },
        { reg: "^#联动清退\\s*(\\d+)$", fnc: "linkedCleanup" },
        { reg: "^#确认清退$", fnc: "confirmCleanup" },
        { reg: "^#取消清退$", fnc: "cancelCleanup" },
        { reg: "^#测试检索清退群\\s*(\\d+)$", fnc: "testSearchCleanup" },
        { reg: "^#测试撤回消息\\s*(\\d+)\\s+(\\d+)$", fnc: "testRecallMessages" }
      ]
    })
  }

  /**
   * 获取需管理群：只收集已配置审核规则的群，排除 stdin 等适配器伪群号。
   * 注意必须用 getGroupArray（返回带 group_name 的对象），
   * getGroupList 只返回群号字符串，拿不到群名。
   */
  async getManagedGroups(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #获取需管理群 命令`)
    if (!await this.checkPermission(e, "master")) return

    e.reply("正在获取~请稍后")

    const groupArray = Bot.getGroupArray?.() || []
    const groups = Array.isArray(groupArray) ? groupArray : Array.from(groupArray.values?.() || groupArray)
    const groupRules = DataStore.getGroupRules()

    const managedGroups = {}
    for (const group of groups) {
      const groupId = String(group?.group_id || group?.id || group || "")
      if (!/^\d+$/.test(groupId)) continue
      const rule = groupRules[groupId]
      if (!rule || rule === "none") continue

      let groupName = group?.group_name || group?.name || ""
      if (!groupName || groupName === "未知群") groupName = await this.fetchGroupName(groupId)

      managedGroups[groupId] = { groupId, groupName, rule, memberCount: 0 }
    }

    if (Object.keys(managedGroups).length === 0) {
      return e.reply("未找到已配置审核规则的群，请先使用 #设置入群规则 或 #开启入群审核")
    }

    DataStore.saveManagedGroupList(managedGroups)

    const ruleText = { reject: "拒绝", phone_verify: "手机号验证", verify: "全部验证" }
    let msg = `已获取需管理群\n\n`
    Object.values(managedGroups).forEach((g, index) => {
      msg += `${index + 1}. ${g.groupName}（${g.groupId}）[${ruleText[g.rule] || g.rule}]\n`
    })
    msg += `\n共 ${Object.keys(managedGroups).length} 个群`

    e.reply(msg)
    logger.info(`${Log_Prefix} [命令执行] #获取需管理群 成功，共${Object.keys(managedGroups).length}个群`)
  }

  async getAllGroupMembers(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #获取所有群员 命令`)
    if (!await this.checkPermission(e, "master")) return

    const managedGroups = DataStore.getManagedGroupList()
    const groupIds = Object.keys(managedGroups)

    if (groupIds.length === 0) {
      return e.reply("请先执行 #获取需管理群 获取群列表")
    }

    e.reply("正在获取~请稍后")

    const membersData = {}
    let totalMembers = 0
    const failedGroups = []

    for (const groupId of groupIds) {
      const groupInfo = managedGroups[groupId]
      if (!/^\d+$/.test(String(groupId))) continue
      try {
        const group = Bot.pickGroup(groupId)
        if (!group) {
          failedGroups.push(groupId)
          continue
        }

        let memberList = []
        if (typeof group.getMemberList === "function") {
          const members = await group.getMemberList()
          memberList = Array.isArray(members) ? members : (members ? Array.from(members.values?.() || members) : [])
        }

        const resolvedName = (groupInfo.groupName && groupInfo.groupName !== "未知群")
          ? groupInfo.groupName
          : await this.fetchGroupName(groupId)

        membersData[groupId] = {
          groupName: resolvedName,
          memberCount: memberList.length,
          members: memberList.map(m => ({
            qq: String(m.qq || m.user_id || m.id || m.userId || ""),
            nickname: m.nickname || m.card || m.name || m.nick || "",
            role: m.role || m.role_name || ""
          }))
        }
        totalMembers += memberList.length
        logger.info(`${Log_Prefix} [群成员获取] 群 ${resolvedName}(${groupId}) 获取${memberList.length}个成员`)
      } catch (err) {
        failedGroups.push(groupId)
        logger.error(`${Log_Prefix} [群成员获取] 群 ${groupId} 获取失败: ${err.message}`)
      }
    }

    DataStore.saveGroupMembers(membersData)

    let msg = `获取群成员完成\n\n`
    for (const [groupId, data] of Object.entries(membersData)) {
      msg += `${data.groupName}（${groupId}） ${data.memberCount}人\n`
    }
    if (failedGroups.length > 0) msg += `\n${failedGroups.length}个群获取失败\n`
    msg += `\n共 ${Object.keys(membersData).length} 个群，${totalMembers} 人`

    e.reply(msg)
    logger.info(`${Log_Prefix} [命令执行] #获取所有群员 成功，共${Object.keys(membersData).length}个群，${totalMembers}人`)
  }

  async linkedCleanup(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #联动清退 命令`)
    if (!await this.checkPermission(e, "master")) return

    const match = e.msg.match(/^#联动清退\s*(\d+)$/)
    if (!match) return e.reply("格式错误，请使用：#联动清退 QQ号")

    const qq = match[1]
    e.reply(`收到，正在对此qq号（${qq}）进行检索`)

    const foundInGroups = DataStore.searchUserInGroups(qq)
    if (foundInGroups.length === 0) {
      logger.info(`${Log_Prefix} [联动清退] QQ ${qq} 未在任何群内找到`)
      return e.reply(`未在任何管理群内找到QQ ${qq}，请先执行 #获取所有群员 更新成员数据`)
    }

    let msg = `已完成对此QQ（${qq}）的检索，共在${foundInGroups.length}个群内找到此qq\n\n`
    foundInGroups.forEach((g, index) => {
      msg += `${index + 1}. ${g.groupName}（${g.groupId}）昵称：${g.nickname}\n`
    })
    msg += `\n请确认是否确认（回复 #确认清退 执行，#取消清退 取消）`

    e.reply(msg)
    DataStore.setPendingCleanup({
      qq,
      groups: foundInGroups,
      operator: String(e.user_id),
      createTime: Date.now(),
      status: "pending"
    })
    logger.info(`${Log_Prefix} [联动清退] QQ ${qq} 在${foundInGroups.length}个群内找到，等待确认`)
  }

  async confirmCleanup(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #确认清退 命令`)
    if (!await this.checkPermission(e, "master")) return

    const pending = DataStore.getPendingCleanup()
    if (!pending || !pending.qq || pending.status !== "pending") {
      return e.reply("没有待确认的清退操作，请先执行 #联动清退 QQ号")
    }
    if (String(e.user_id) !== String(pending.operator)) {
      return e.reply("该清退操作仅能由发起人确认")
    }

    e.reply(`正在执行对QQ ${pending.qq} 的清退操作，请稍候...`)

    let totalRecalled = 0
    let totalKicked = 0
    const qq = pending.qq

    for (const groupInfo of pending.groups) {
      const groupId = groupInfo.groupId
      try {
        const group = Bot.pickGroup(groupId)
        if (!group) continue

        // 适配器签名: getChatHistory(message_seq, count, reverseOrder)
        // 取最近 100 条后按 sender.user_id 过滤，只撤回目标用户的消息
        let recalled = 0
        let messages = []
        if (typeof group.getChatHistory === "function") {
          try {
            const res = await group.getChatHistory(undefined, 100)
            messages = Array.isArray(res) ? res : (res?.messages || [])
          } catch (err) {
            logger.warn(`${Log_Prefix} [清退执行] 群 ${groupId} 拉取历史消息失败: ${err.message}`)
          }
        }

        if (Array.isArray(messages)) {
          for (const msg of messages) {
            const senderId = String(msg?.sender?.user_id ?? msg?.user_id ?? "")
            // 必须确认是目标用户发的，否则会误撤回他人消息
            if (senderId !== String(qq)) continue
            const messageId = msg?.message_id || msg?.messageId || msg?.id
            if (!messageId) continue
            try {
              if (typeof group.recallMsg === "function") {
                await group.recallMsg(messageId)
                recalled++
              }
            } catch (err) {
              logger.warn(`${Log_Prefix} [清退执行] 群 ${groupId} 撤回消息 ${messageId} 失败: ${err.message}`)
            }
          }
        }

        // 适配器签名: kickMember(user_id, reject_add_request)
        // 仅踢出，不勾选"拒绝再次加群"，第2参必须为 false
        let kicked = false
        if (typeof group.kickMember === "function") {
          try {
            await group.kickMember(qq, false)
            kicked = true
            totalKicked++
          } catch (err) {
            logger.error(`${Log_Prefix} [清退执行] 群 ${groupId} 踢出失败: ${err.message}`)
          }
        }

        totalRecalled += recalled
        logger.info(`${Log_Prefix} [清退执行] 群 ${groupId}(${groupInfo.groupName || "未知"}): 撤回${recalled}条消息, ${kicked ? "已踢出" : "踢出失败"}`)
      } catch (err) {
        logger.error(`${Log_Prefix} [清退执行] 群 ${groupId} 操作失败: ${err.message}`)
      }
    }

    DataStore.clearPendingCleanup()

    let msg = `已完成对此QQ（${qq}）的清退\n`
    msg += `共${pending.groups.length}个群，${totalRecalled}条消息已撤回`
    if (totalKicked < pending.groups.length) {
      msg += `，${pending.groups.length - totalKicked}个群踢出失败`
    }

    e.reply(msg)
    logger.info(`${Log_Prefix} [联动清退] QQ ${qq} 清退完成，共${pending.groups.length}个群，撤回${totalRecalled}条消息`)
  }

  async testSearchCleanup(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #测试检索清退群 命令`)
    if (!await this.checkPermission(e, "master")) return

    const match = e.msg.match(/^#测试检索清退群\s*(\d+)$/)
    if (!match) return e.reply("格式错误，请使用：#测试检索清退群 QQ号")

    const qq = match[1]
    const foundInGroups = DataStore.searchUserInGroups(qq)
    if (foundInGroups.length === 0) return e.reply(`检索结果：QQ ${qq} 不在任何管理群内`)

    let msg = `检索结果：QQ ${qq} 在${foundInGroups.length}个管理群内\n\n`
    foundInGroups.forEach((g, index) => {
      msg += `${index + 1}. ${g.groupName}（${g.groupId}）昵称：${g.nickname}，群人数：${g.memberCount}\n`
    })

    e.reply(msg)
    logger.info(`${Log_Prefix} [测试检索] QQ ${qq} 在${foundInGroups.length}个群内找到`)
  }

  async testRecallMessages(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #测试撤回消息 命令`)
    if (!await this.checkPermission(e, "master")) return

    const match = e.msg.match(/^#测试撤回消息\s*(\d+)\s+(\d+)$/)
    if (!match) return e.reply("格式错误，请使用：#测试撤回消息 QQ号 秒数")

    const qq = match[1]
    const seconds = parseInt(match[2])
    e.reply(`正在检索QQ ${qq} 在${seconds}秒内的消息...`)

    const managedGroups = DataStore.getManagedGroupList()
    const groupIds = Object.keys(managedGroups)
    if (groupIds.length === 0) return e.reply("请先执行 #获取需管理群 和 #获取所有群员")

    const now = Date.now()
    const startTime = now - seconds * 1000
    let totalFound = 0
    const results = []

    for (const groupId of groupIds) {
      try {
        const group = Bot.pickGroup(groupId)
        if (!group) continue

        // 适配器签名: getChatHistory(message_seq, count, reverseOrder)
        let messages = []
        if (typeof group.getChatHistory === "function") {
          try {
            const res = await group.getChatHistory(undefined, 100)
            messages = Array.isArray(res) ? res : (res?.messages || [])
          } catch (err) {
            logger.warn(`${Log_Prefix} [测试撤回] 群 ${groupId} 拉取历史失败: ${err.message}`)
          }
        }

        // 按发送者与时间窗过滤
        const hit = (Array.isArray(messages) ? messages : []).filter(m => {
          const senderId = String(m?.sender?.user_id ?? m?.user_id ?? "")
          if (senderId !== String(qq)) return false
          const t = Number(m?.time || m?.timestamp || 0) * 1000
          return !t || (t >= startTime && t <= now)
        })

        if (hit.length > 0) {
          totalFound += hit.length
          results.push({
            groupId,
            groupName: managedGroups[groupId]?.groupName || groupId,
            count: hit.length
          })
        }
      } catch (err) {
        logger.error(`${Log_Prefix} [测试撤回] 群 ${groupId} 检索失败: ${err.message}`)
      }
    }

    let msg = `撤回消息测试结果\n\n`
    msg += `QQ：${qq}\n时间范围：最近${seconds}秒\n共找到：${totalFound}条消息\n\n`
    if (results.length > 0) {
      results.forEach(r => { msg += `群 ${r.groupName}（${r.groupId}）：${r.count}条\n` })
    } else {
      msg += `未找到消息\n`
    }
    msg += `\n仅为测试，未实际撤回消息`

    e.reply(msg)
    logger.info(`${Log_Prefix} [测试撤回] QQ ${qq} 在${seconds}秒内共找到${totalFound}条消息`)
  }

  async cancelCleanup(e) {
    logger.info(`${Log_Prefix} [命令执行] 用户 ${e.user_id} 执行 #取消清退 命令`)
    if (!await this.checkPermission(e, "master")) return

    const pending = DataStore.getPendingCleanup()
    if (!pending || !pending.qq) return e.reply("没有待取消的清退操作")
    if (String(e.user_id) !== String(pending.operator)) return e.reply("该清退操作仅能由发起人取消")

    DataStore.clearPendingCleanup()
    e.reply(`已取消对QQ ${pending.qq} 的清退操作`)
    logger.info(`${Log_Prefix} [联动清退] 已取消QQ ${pending.qq} 的清退操作`)
  }
}

export default Cleanup
