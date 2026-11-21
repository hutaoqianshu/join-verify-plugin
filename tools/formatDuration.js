export default function formatDuration(seconds, type = "default") {
  if (!seconds || seconds <= 0) return "已到期"
  
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  if (type === "simple") {
    if (days > 0) return `${days}天`
    if (hours > 0) return `${hours}小时`
    if (minutes > 0) return `${minutes}分钟`
    return `${secs}秒`
  }
  
  let result = ""
  if (days > 0) result += `${days}天 `
  if (hours > 0) result += `${hours}小时 `
  if (minutes > 0) result += `${minutes}分钟 `
  if (secs > 0 || result === "") result += `${secs}秒`
  
  return result.trim()
}
