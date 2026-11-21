import { Log_Prefix } from "#join-verify.components"

/** 单项实测超时时间 */
const PROBE_TIMEOUT = 6000

function isFn(obj, key) {
  return typeof obj?.[key] === "function"
}

function safeGet(fn, fallback = undefined) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function readSize(value) {
  if (!value) return 0
  if (typeof value.size === "number") return value.size
  if (Array.isArray(value)) return value.length
  if (typeof value === "object") return Object.keys(value).length
  return 0
}

function pick(obj, ...keys) {
  for (const key of keys) {
    const value = safeGet(() => obj?.[key])
    if (value !== undefined && value !== null && value !== "") return value
  }
  return undefined
}

/**
 * 执行一次带超时的实测，返回耗时与结果，任何异常都转成失败信息而不是抛出
 */
async function measure(fn) {
  const start = Date.now()
  let timer
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("请求超时")), PROBE_TIMEOUT)
        timer.unref?.()
      })
    ])
    return { ok: true, latency: Date.now() - start, value }
  } catch (error) {
    return { ok: false, latency: Date.now() - start, error: error?.message || String(error) }
  } finally {
    clearTimeout(timer)
  }
}

function readClientName(bot) {
  const version = safeGet(() => bot?.version)
  if (!version) return "未知"
  if (typeof version === "string") return version
  const name = version.name || version.id || ""
  const ver = version.version || ""
  if (name && ver) return `${name} ${ver}`
  if (name || ver) return String(name || ver)
  return "未知"
}

function listAdapters() {
  const adapters = safeGet(() => Bot.adapter) || []
  const names = [...adapters].map(a => a?.name || a?.id).filter(Boolean)
  return [...new Set(names)].join(" / ") || "未知"
}

/**
 * 入群申请处理链路，顺序与 apps/events/request.js 的尝试顺序保持一致
 */
function probeRequestChain(bot, group, e) {
  return [
    {
      name: "bot.sendApi → set_group_add_request",
      ok: isFn(bot, "sendApi"),
      reason: true
    },
    {
      name: "bot.internal.sendApi → set_group_add_request",
      ok: isFn(bot?.internal, "sendApi"),
      reason: true
    },
    {
      name: "bot.setGroupAddRequest(flag, type, approve, reason)",
      ok: isFn(bot, "setGroupAddRequest"),
      reason: true
    },
    {
      name: "bot.set_group_add_request(flag, type, approve, reason)",
      ok: isFn(bot, "set_group_add_request"),
      reason: true
    },
    {
      name: "group.processRequest(seq, approve, reason)",
      ok: isFn(group, "processRequest"),
      reason: true
    },
    {
      name: "e.approve / e.reject（仅申请事件内可用）",
      ok: isFn(e, "approve") || isFn(e, "reject"),
      reason: false,
      eventOnly: true
    }
  ]
}

function probeQueryApis(bot, group) {
  return [
    { name: "Bot.pickGroup", ok: isFn(Bot, "pickGroup") },
    { name: "Bot.pickMember", ok: isFn(Bot, "pickMember") },
    { name: "Bot.getGroupList", ok: isFn(Bot, "getGroupList") },
    { name: "Bot.getGroupMemberList", ok: isFn(Bot, "getGroupMemberList") },
    { name: "Bot.getChatHistory", ok: isFn(Bot, "getChatHistory") },
    { name: "Bot.recallMsg", ok: isFn(Bot, "recallMsg") },
    { name: "group.sendMsg（通知群推送）", ok: isFn(group, "sendMsg") },
    { name: "group.getMemberMap（成员缓存）", ok: isFn(group, "getMemberMap") }
  ]
}

/**
 * 写操作只做能力探测，不实际调用，避免误踢人/禁言
 */
function probeWriteApis(bot, group) {
  const viaSendApi = isFn(bot, "sendApi") || isFn(bot?.internal, "sendApi")
  return [
    { name: "踢出成员", ok: isFn(bot, "setGroupKick") || isFn(bot, "set_group_kick") || isFn(group, "kick") || viaSendApi },
    { name: "禁言成员", ok: isFn(bot, "setGroupBan") || isFn(bot, "set_group_ban") || isFn(group, "mute") || viaSendApi },
    { name: "撤回消息", ok: isFn(Bot, "recallMsg") || viaSendApi },
    { name: "设置管理员", ok: isFn(group, "setAdmin") || isFn(bot, "set_group_admin") || viaSendApi },
    { name: "修改群名片", ok: isFn(group, "setCard") || isFn(bot, "set_group_card") || viaSendApi }
  ]
}

function mark(ok) {
  return ok ? "[可用]" : "[不可用]"
}

class ApiProbe {
  /**
   * 探测当前协议端对插件所需 QQ 接口的支持情况
   * @param {{ bot?: object, e?: object, groupId?: string }} options
   */
  async probe({ bot, e, groupId }) {
    const targetGroupId = String(groupId || safeGet(() => e?.group_id) || "")
    // 群对象：icqq 下在 bot 上，OneBot 系在框架 Bot 上，两个都要试
    const groupPicker = isFn(bot, "pickGroup")
      ? id => bot.pickGroup(id)
      : isFn(Bot, "pickGroup")
        ? id => Bot.pickGroup(id)
        : null
    const group = targetGroupId && groupPicker
      ? safeGet(() => groupPicker(targetGroupId), null)
      : null

    const requestChain = probeRequestChain(bot, group, e)
    const queryApis = probeQueryApis(bot, group)
    const writeApis = probeWriteApis(bot, group)

    // 实测：群列表
    let groupListResult = null
    if (isFn(Bot, "getGroupList")) {
      groupListResult = await measure(() => Bot.getGroupList())
    }
    const cachedGroups = readSize(safeGet(() => bot?.gl))

    // 实测：当前群成员（优先读缓存，避免大群拉取过慢）
    let memberCount = null
    let memberResult = null
    const cachedMemberMap = safeGet(() => (isFn(group, "getMemberMap") ? group.getMemberMap() : null))
    if (cachedMemberMap) {
      memberCount = readSize(cachedMemberMap)
    } else if (targetGroupId && isFn(Bot, "getGroupMemberList")) {
      memberResult = await measure(() => Bot.getGroupMemberList(targetGroupId))
      if (memberResult.ok) memberCount = readSize(memberResult.value)
    }

    const groupName = pick(group?.info, "group_name", "name")
      || pick(group, "group_name", "name")
      || "未知"

    const accounts = [...(safeGet(() => Bot.uin) || [])].join(",")
    const env = {
      adapter: listAdapters(),
      account: String(pick(bot, "uin", "self_id") ?? (accounts || "未知")),
      client: readClientName(bot),
      groups: groupListResult?.ok ? readSize(groupListResult.value) : cachedGroups,
      friends: readSize(safeGet(() => bot?.fl))
    }

    const activeChain = requestChain.find(item => item.ok && !item.eventOnly)
    const onlyEventApi = !activeChain && requestChain.some(item => item.ok && item.eventOnly)

    const lines = []
    lines.push("QQ接口测试")
    lines.push("")
    lines.push("【运行环境】")
    lines.push(`适配器：${env.adapter}`)
    lines.push(`账号：${env.account}`)
    lines.push(`协议端：${env.client}`)
    lines.push(`群缓存：${env.groups} 个群 / ${env.friends} 位好友`)
    lines.push("")

    lines.push("【入群申请：同意/拒绝】")
    for (const item of requestChain) {
      const label = item.eventOnly && !item.ok ? "[仅事件]" : mark(item.ok)
      lines.push(`${label} ${item.name}${item.reason && item.ok ? "（支持拒绝理由）" : ""}`)
    }
    if (activeChain) {
      lines.push(`生效链路：${activeChain.name}`)
    } else if (onlyEventApi) {
      lines.push("生效链路：e.approve / e.reject（仅布尔，拒绝理由会丢失）")
    } else {
      lines.push("生效链路：无，加群申请无法处理")
    }
    lines.push("")

    lines.push("【群与成员接口】")
    for (const item of queryApis) {
      lines.push(`${mark(item.ok)} ${item.name}`)
    }
    lines.push("")

    lines.push("【写操作接口（仅探测，未调用）】")
    for (const item of writeApis) {
      lines.push(`${mark(item.ok)} ${item.name}`)
    }
    lines.push("")

    lines.push("【实测】")
    if (groupListResult) {
      lines.push(groupListResult.ok
        ? `群列表：${readSize(groupListResult.value)} 个群，耗时 ${groupListResult.latency}ms`
        : `群列表：获取失败，${groupListResult.error}（缓存 ${cachedGroups} 个群）`)
    } else {
      lines.push(`群列表：接口不可用（缓存 ${cachedGroups} 个群）`)
    }
    if (memberCount !== null) {
      lines.push(memberResult
        ? `当前群成员：${memberCount} 人，耗时 ${memberResult.latency}ms`
        : `当前群成员：${memberCount} 人，来自缓存`)
    } else {
      lines.push("当前群成员：获取失败")
    }
    lines.push(`当前群：${targetGroupId || "未知"}（${groupName}）`)
    lines.push("")

    lines.push("【结论】")
    if (activeChain) {
      lines.push(`入群审核可用，同意/拒绝走 ${activeChain.name}。`)
      lines.push("需要验证完整审核流程请使用 #测试验证。")
    } else if (onlyEventApi) {
      lines.push("入群审核可用但依赖 e.approve，拒绝理由无法保证推送给申请方。")
    } else {
      lines.push("入群审核不可用，请更换支持 set_group_add_request 的协议端。")
    }

    const data = { env, requestChain, queryApis, writeApis, activeChain: activeChain?.name || "", targetGroupId }
    logger.debug(`${Log_Prefix} [接口测试] 探测结果 ${JSON.stringify(data)}`)
    return { text: lines.join("\n"), data }
  }
}

export default new ApiProbe()
