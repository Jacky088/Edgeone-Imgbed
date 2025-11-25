import { PACKAGE_NAME, PACKAGE_VERSION } from './_utils'

// 这个文件就是我们的"数据库"，存储在 CNB 制品库中
const DB_FILENAME = 'database.json'

// 简单的内存缓存，减少读取请求
let memoryCache: ImageRecord[] | null = null

export interface ImageRecord {
  id: string
  name: string
  url: string
  urlOriginal?: string
  thumbnailUrl?: string
  thumbnailOriginalUrl?: string
  size: number
  type: string
  createdAt: number
}

// 从远程下载数据库
async function fetchDB(): Promise<ImageRecord[]> {
  const slug = process.env.SLUG_IMG
  if (!slug) return []

  const url = `https://api.cnb.cool/${slug}/-/packages/generic/${PACKAGE_NAME}/${PACKAGE_VERSION}/${DB_FILENAME}`
  
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.TOKEN_IMG}`,
        'Cache-Control': 'no-cache' // 务必禁用缓存
      }
    })

    if (resp.status === 404) return [] // 第一次使用时文件不存在
    if (!resp.ok) return []

    const data = await resp.json()
    return Array.isArray(data) ? data : []
  } catch (e) {
    console.error('Fetch DB error:', e)
    return []
  }
}

// 上传数据库到远程
async function saveDB(data: ImageRecord[]) {
  const slug = process.env.SLUG_IMG
  if (!slug) return

  const url = `https://api.cnb.cool/${slug}/-/packages/generic/${PACKAGE_NAME}/${PACKAGE_VERSION}/${DB_FILENAME}`
  
  try {
    const jsonString = JSON.stringify(data, null, 2)
    
    await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.TOKEN_IMG}`,
        'Content-Type': 'application/json',
      },
      body: jsonString,
    })
  } catch (e) {
    console.error('Save DB error:', e)
  }
}

export const store = {
  // 异步获取列表
  getAll: async (): Promise<ImageRecord[]> => {
    // 如果内存有，直接返回（Serverless 热启动时加速）
    if (memoryCache) return memoryCache
    
    // 否则从远程拉取
    const data = await fetchDB()
    memoryCache = data
    return data
  },

  // 异步添加记录
  add: async (record: ImageRecord) => {
    let list = await store.getAll()
    
    // 插入头部
    list.unshift(record)
    if (list.length > 2000) list.pop() // 限制 2000 条
    
    memoryCache = list
    // 必须等待保存完成
    await saveDB(list)
  },

  // 异步删除记录
  remove: async (id: string) => {
    let list = await store.getAll()
    const newList = list.filter(item => item.id !== id)
    
    memoryCache = newList
    await saveDB(newList)
  }
}
