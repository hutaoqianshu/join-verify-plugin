import fs from "node:fs"
import path from "node:path"
import { Plugin_Path } from "../constants/path.js"
import Config from "./Config.js"

const DATA_PATH = `${Plugin_Path}/data`

class DataStore {
  constructor() {
    if (!fs.existsSync(DATA_PATH)) {
      fs.mkdirSync(DATA_PATH, { recursive: true })
    }
  }

  /**
   * 读取 JSON 数据文件。
   * @param {string} fileName 文件名
   * @param {any} defaultValue 文件缺失/损坏时的兜底值。
   *   数组类数据（redUsers/apiList/auditLogs）必须传 []，否则后续 .filter/.sort 会抛错。
   */
  readJSON(fileName, defaultValue = {}) {
    const filePath = path.join(DATA_PATH, fileName)
    const fallback = defaultValue !== null && typeof defaultValue === "object"
      ? JSON.parse(JSON.stringify(defaultValue))
      : defaultValue
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"))
        // 类型不符时也回退，避免脏数据导致运行时崩溃
        if (Array.isArray(fallback) !== Array.isArray(data)) {
          logger.warn(`[Join-Verify] ${fileName} 类型异常，已重置为默认值`)
          return fallback
        }
        return data
      } catch (e) {
        logger.error(`[Join-Verify] 读取文件失败: ${fileName}，使用默认值`)
        return fallback
      }
    }
    return fallback
  }

  writeJSON(fileName, data) {
    const filePath = path.join(DATA_PATH, fileName)
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8")
      return true
    } catch (e) {
      logger.error(`[Join-Verify] 写入文件失败: ${fileName}`)
      return false
    }
  }

  getBindings() {
    return this.readJSON("bindings.json")
  }

  saveBinding(phone, qq, appId = "") {
    const bindings = this.getBindings()
    bindings[phone] = { qq, appId, bindTime: Date.now() }
    return this.writeJSON("bindings.json", bindings)
  }

  getBindingByPhone(phone) {
    const bindings = this.getBindings()
    return bindings[phone] || null
  }

  getBindingByQQ(qq) {
    const bindings = this.getBindings()
    for (const [phone, data] of Object.entries(bindings)) {
      if (data.qq === qq) {
        return { phone, ...data }
      }
    }
    return null
  }

  /**
   * QQ 号归一化：协议层 e.user_id 是 number，命令参数是 string，
   * 统一转成 string 再比较，避免严格相等导致黑白名单整体失效。
   */
  normalizeQQ(qq) {
    if (qq === undefined || qq === null) return ""
    return String(qq).trim()
  }

  getRedUsers() {
    const list = this.readJSON("redUsers.json", [])
    return Array.isArray(list) ? list.map(qq => this.normalizeQQ(qq)).filter(Boolean) : []
  }

  addRedUser(qq) {
    const key = this.normalizeQQ(qq)
    if (!key) return false
    const redUsers = this.getRedUsers()
    if (!redUsers.includes(key)) {
      redUsers.push(key)
      return this.writeJSON("redUsers.json", redUsers)
    }
    return false
  }

  removeRedUser(qq) {
    const key = this.normalizeQQ(qq)
    if (!key) return false
    const redUsers = this.getRedUsers()
    const index = redUsers.indexOf(key)
    if (index > -1) {
      redUsers.splice(index, 1)
      return this.writeJSON("redUsers.json", redUsers)
    }
    return false
  }

  isRedUser(qq) {
    const key = this.normalizeQQ(qq)
    if (!key) return false
    return this.getRedUsers().includes(key)
  }

  getBlacklist() {
    return this.readJSON("blacklist.json")
  }

  /**
   * 构造"本群已满"导流拒绝理由。
   * 全局共用一个导流目标，由 #设置导流x群群号+qq群号 维护。
   * 未配置或关闭时退回原文案，保证老行为不变。
   */
  getDiversionReason() {
    let cfg = {}
    try {
      cfg = Config.getConfig("config") || {}
    } catch {
      cfg = {}
    }
    if (cfg.diversionEnabled === false) return "该群已设置为全部拒绝入群申请"

    const index = this.normalizeQQ(cfg.diversionIndex)
    const groupId = this.normalizeQQ(cfg.diversionGroupId)
    if (!index || !groupId) return "该群已设置为全部拒绝入群申请"

    const template = cfg.diversionText || "本群已满，请加{index}群{groupId}"
    return template.replace(/\{index\}/g, index).replace(/\{groupId\}/g, groupId)
  }

  addToBlacklist(groupId, qq, duration) {
    const blacklist = this.getBlacklist()
    const groupKey = String(groupId)
    const qqKey = String(qq)
    const expireTime = Date.now() + duration * 1000
    
    if (!blacklist[groupKey]) blacklist[groupKey] = {}
    if (!blacklist[groupKey][qqKey] || blacklist[groupKey][qqKey].expireTime < expireTime) {
      blacklist[groupKey][qqKey] = { expireTime, createTime: Date.now() }
      return this.writeJSON("blacklist.json", blacklist)
    }
    return false
  }

  removeFromBlacklist(groupId, qq) {
    const blacklist = this.getBlacklist()
    const groupKey = String(groupId)
    const qqKey = String(qq)
    if (blacklist[groupKey] && blacklist[groupKey][qqKey]) {
      delete blacklist[groupKey][qqKey]
      if (Object.keys(blacklist[groupKey]).length === 0) {
        delete blacklist[groupKey]
      }
      return this.writeJSON("blacklist.json", blacklist)
    }
    return false
  }

  isInBlacklist(groupId, qq) {
    const blacklist = this.getBlacklist()
    const groupKey = String(groupId)
    const qqKey = String(qq)
    if (!blacklist[groupKey] || !blacklist[groupKey][qqKey]) return false
    return blacklist[groupKey][qqKey].expireTime > Date.now()
  }

  getBlacklistExpireTime(groupId, qq) {
    const blacklist = this.getBlacklist()
    const groupKey = String(groupId)
    const qqKey = String(qq)
    return blacklist[groupKey]?.[qqKey]?.expireTime || 0
  }

  cleanExpiredBlacklist() {
    const blacklist = this.getBlacklist()
    const applyCounts = this.readJSON("applyCounts.json")
    const now = Date.now()
    let cleaned = false
    
    for (const [groupKey, groupBlacklist] of Object.entries(blacklist)) {
      for (const [qqKey, data] of Object.entries(groupBlacklist)) {
        if (data.expireTime <= now) {
          delete groupBlacklist[qqKey]
          if (applyCounts[groupKey] && applyCounts[groupKey][qqKey]) {
            applyCounts[groupKey][qqKey] = 0
          }
          cleaned = true
        }
      }
      if (Object.keys(groupBlacklist).length === 0) {
        delete blacklist[groupKey]
      }
    }
    
    if (cleaned) {
      this.writeJSON("blacklist.json", blacklist)
      this.writeJSON("applyCounts.json", applyCounts)
    }
    return cleaned
  }

  getApplyCounts() {
    return this.readJSON("applyCounts.json")
  }

  getApplyCount(groupId, qq) {
    const counts = this.getApplyCounts()
    const groupKey = String(groupId)
    const qqKey = String(qq)
    return counts[groupKey]?.[qqKey] || 0
  }

  incrementApplyCount(groupId, qq) {
    const counts = this.getApplyCounts()
    const groupKey = String(groupId)
    const qqKey = String(qq)
    if (!counts[groupKey]) counts[groupKey] = {}
    counts[groupKey][qqKey] = (counts[groupKey][qqKey] || 0) + 1
    return this.writeJSON("applyCounts.json", counts)
  }

  resetApplyCount(groupId, qq) {
    const counts = this.getApplyCounts()
    const groupKey = String(groupId)
    const qqKey = String(qq)
    if (counts[groupKey] && counts[groupKey][qqKey]) {
      counts[groupKey][qqKey] = 0
      return this.writeJSON("applyCounts.json", counts)
    }
    return false
  }

  getApiList() {
    return this.readJSON("apiList.json", [])
  }

  addApi(url, latency = 0, available = true) {
    const apiList = this.getApiList()
    if (!apiList.find(api => api.url === url)) {
      apiList.push({
        url,
        latency,
        available,
        lastCheckTime: Date.now(),
        createTime: Date.now()
      })
      return this.writeJSON("apiList.json", apiList)
    }
    return false
  }

  updateApi(url, updates) {
    const apiList = this.getApiList()
    const index = apiList.findIndex(api => api.url === url)
    if (index > -1) {
      apiList[index] = { ...apiList[index], ...updates, lastCheckTime: Date.now() }
      return this.writeJSON("apiList.json", apiList)
    }
    return false
  }

  removeApi(url) {
    const apiList = this.getApiList()
    const filtered = apiList.filter(api => api.url !== url)
    if (filtered.length !== apiList.length) {
      return this.writeJSON("apiList.json", filtered)
    }
    return false
  }

  getAvailableApis() {
    return this.getApiList().filter(api => api.available)
  }

  getFastestApi() {
    const available = this.getAvailableApis()
    if (available.length === 0) return null
    return available.reduce((fastest, api) => 
      api.latency < fastest.latency ? api : fastest
    )
  }

  /**
   * 审核日志轮转：单文件超过上限时，把较旧的一半归档到 auditLogs.N.json，
   * 只保留最近 ARCHIVE_KEEP 份，避免 auditLogs.json 无限增长（每次写入都要全量读写）。
   */
  rotateAuditLogs(logs) {
    const MAX = 3000      // 单文件最多保留条数
    const KEEP = 5        // 最多保留几个归档文件
    const BATCH = 500     // 超出这么多才归档一次，避免每写一条就产生碎片归档
    if (logs.length < MAX + BATCH) return logs

    const overflow = logs.splice(0, logs.length - MAX)
    let seq = 1
    while (fs.existsSync(path.join(DATA_PATH, `auditLogs.${seq}.json`))) seq++
    try {
      fs.writeFileSync(path.join(DATA_PATH, `auditLogs.${seq}.json`),
        JSON.stringify(overflow, null, 2), "utf8")
      logger.info(`[Join-Verify] 审核日志已归档 ${overflow.length} 条 -> auditLogs.${seq}.json`)
    } catch (e) {
      logger.error(`[Join-Verify] 审核日志归档失败: ${e.message}`)
    }

    // 只保留最新 KEEP 份归档，更旧的删掉
    const archives = fs.readdirSync(DATA_PATH)
      .filter(f => /^auditLogs\.\d+\.json$/.test(f))
      .map(f => ({ f, n: Number(f.match(/^auditLogs\.(\d+)\.json$/)[1]) }))
      .sort((a, b) => a.n - b.n)
    while (archives.length > KEEP) {
      const old = archives.shift()
      try {
        fs.unlinkSync(path.join(DATA_PATH, old.f))
        logger.info(`[Join-Verify] 已清理旧归档 ${old.f}`)
      } catch {}
    }

    return logs
  }

  addAuditLog(log) {
    let logs = this.readJSON("auditLogs.json", [])
    if (!Array.isArray(logs)) logs = []
    logs.push({
      ...log,
      timestamp: Date.now()
    })
    logs = this.rotateAuditLogs(logs)
    return this.writeJSON("auditLogs.json", logs)
  }

  getAuditLogs(page = 1, pageSize = 20, filters = {}) {
    const logs = this.readJSON("auditLogs.json", [])
    let filtered = logs

    if (filters.groupId) {
      filtered = filtered.filter(log => log.groupId === filters.groupId)
    }
    if (filters.qq) {
      filtered = filtered.filter(log => log.qq === filters.qq)
    }
    if (filters.status !== undefined) {
      filtered = filtered.filter(log => log.status === filters.status)
    }
    if (filters.startTime) {
      filtered = filtered.filter(log => log.applyTime >= filters.startTime)
    }
    if (filters.endTime) {
      filtered = filtered.filter(log => log.applyTime <= filters.endTime)
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp)
    
    const total = filtered.length
    const start = (page - 1) * pageSize
    const end = start + pageSize

    return {
      data: filtered.slice(start, end),
      total,
      page,
      pageSize,
      pages: Math.ceil(total / pageSize)
    }
  }

  getGroupRules() {
    return this.readJSON("groupRules.json")
  }

  getGroupRule(groupId) {
    const rules = this.getGroupRules()
    return rules[String(groupId)] || "none"
  }

  setGroupRule(groupId, rule) {
    const rules = this.getGroupRules()
    rules[String(groupId)] = rule
    return this.writeJSON("groupRules.json", rules)
  }

  removeGroupRule(groupId) {
    const rules = this.getGroupRules()
    delete rules[String(groupId)]
    return this.writeJSON("groupRules.json", rules)
  }

  getStatistics() {
    return this.readJSON("statistics.json")
  }

  updateStatistics(groupId, status) {
    const stats = this.getStatistics()
    const groupKey = String(groupId)
    
    if (!stats[groupKey]) {
      stats[groupKey] = { approved: 0, rejected: 0, blacklisted: 0 }
    }
    
    if (status === "approved") {
      stats[groupKey].approved++
    } else if (status === "rejected") {
      stats[groupKey].rejected++
    } else if (status === "blacklisted") {
      stats[groupKey].blacklisted++
    }
    
    return this.writeJSON("statistics.json", stats)
  }

  getGroupStatistics(groupId) {
    const stats = this.getStatistics()
    return stats[String(groupId)] || { approved: 0, rejected: 0, blacklisted: 0 }
  }

  getAllStatistics() {
    const stats = this.getStatistics()
    let totalApproved = 0
    let totalRejected = 0
    let totalBlacklisted = 0
    
    for (const groupKey of Object.keys(stats)) {
      totalApproved += stats[groupKey].approved || 0
      totalRejected += stats[groupKey].rejected || 0
      totalBlacklisted += stats[groupKey].blacklisted || 0
    }
    
    return {
      totalApproved,
      totalRejected,
      totalBlacklisted,
      byGroup: stats
    }
  }

  getManagedGroupList() {
    return this.readJSON("managedGroups.json")
  }

  saveManagedGroupList(groups) {
    return this.writeJSON("managedGroups.json", groups)
  }

  getGroupMembers() {
    return this.readJSON("groupMembers.json")
  }

  saveGroupMembers(members) {
    return this.writeJSON("groupMembers.json", members)
  }

  getUserMemberInfo(qq) {
    const members = this.getGroupMembers()
    const qqStr = String(qq)
    const result = { qq: qqStr, groups: [] }
    for (const [groupId, groupData] of Object.entries(members)) {
      const membersList = groupData.members || []
      const found = membersList.find(m => String(m.qq) === qqStr || String(m.user_id) === qqStr || String(m.id) === qqStr)
      if (found) {
        result.groups.push({
          groupId,
          groupName: groupData.groupName || "未知群",
          nickname: found.nickname || found.card || found.name || "未知"
        })
      }
    }
    return result
  }

  searchUserInGroups(qq) {
    const members = this.getGroupMembers()
    const qqStr = String(qq)
    const foundInGroups = []
    for (const [groupId, groupData] of Object.entries(members)) {
      const membersList = groupData.members || []
      const found = membersList.find(m => String(m.qq) === qqStr || String(m.user_id) === qqStr || String(m.id) === qqStr)
      if (found) {
        foundInGroups.push({
          groupId,
          groupName: groupData.groupName || "未知群",
          nickname: found.nickname || found.card || found.name || "未知",
          memberCount: groupData.memberCount || membersList.length
        })
      }
    }
    return foundInGroups
  }

  getPendingCleanup() {
    return this.readJSON("pendingCleanup.json")
  }

  setPendingCleanup(data) {
    return this.writeJSON("pendingCleanup.json", data)
  }

  clearPendingCleanup() {
    return this.writeJSON("pendingCleanup.json", {})
  }

  getLeaveUsers() {
    return this.readJSON("leaveUsers.json")
  }

  getLeaveUser(qq) {
    const leaveUsers = this.getLeaveUsers()
    return leaveUsers[String(qq)] || null
  }

  addLeaveUser(qq, groupId) {
    const leaveUsers = this.getLeaveUsers()
    const qqKey = String(qq)
    const groupKey = String(groupId)
    if (!leaveUsers[qqKey]) {
      leaveUsers[qqKey] = {
        groups: [],
        policy: "reject",
        leaveTime: Date.now()
      }
    }
    if (!leaveUsers[qqKey].groups.includes(groupKey)) {
      leaveUsers[qqKey].groups.push(groupKey)
    }
    leaveUsers[qqKey].leaveTime = Date.now()
    return this.writeJSON("leaveUsers.json", leaveUsers)
  }

  removeLeaveUser(qq) {
    const leaveUsers = this.getLeaveUsers()
    const qqKey = String(qq)
    if (leaveUsers[qqKey]) {
      delete leaveUsers[qqKey]
      return this.writeJSON("leaveUsers.json", leaveUsers)
    }
    return false
  }

  setLeaveUserPolicy(qq, policy) {
    const leaveUsers = this.getLeaveUsers()
    const qqKey = String(qq)
    if (leaveUsers[qqKey]) {
      leaveUsers[qqKey].policy = policy
      return this.writeJSON("leaveUsers.json", leaveUsers)
    }
    return false
  }

  getLeaveUserPolicy(qq) {
    const leaveUsers = this.getLeaveUsers()
    const qqKey = String(qq)
    if (leaveUsers[qqKey]) {
      return leaveUsers[qqKey].policy || "reject"
    }
    return null
  }

  isLeaveUser(qq) {
    const leaveUsers = this.getLeaveUsers()
    return !!leaveUsers[String(qq)]
  }
}

export default new DataStore()
