import { PACKAGE_NAME, PACKAGE_VERSION } from './_utils'

const DB_FILENAME = 'database.json'
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

async function fetchDB(): Promise<ImageRecord[]> {
  const slug = process.env.SLUG_IMG
  const url = `https://api.cnb.cool/${slug}/-/packages/generic/${PACKAGE_NAME}/${PACKAGE_VERSION}/${DB_FILENAME}`
  
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.TOKEN_IMG}`,
        'Cache-Control': 'no-cache' 
      }
    })

    if (resp.status === 404) return []
    if (!resp.ok) {
      console.warn('Fetch DB failed:', resp.status)
      return []
    }

    const data = await resp.json()
    return Array.isArray(data) ? data : []
  } catch (e) {
    console.error('Fetch DB error:', e)
    return []
  }
}

async function saveDB(data: ImageRecord[]) {
  const slug = process.env.SLUG_IMG
  const url = `https://api.cnb.cool/${slug}/-/packages/generic/${PACKAGE_NAME}/${PACKAGE_VERSION}/${DB_FILENAME}`
  
  try {
    const jsonString = JSON.stringify(data, null, 2)
    
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.TOKEN_IMG}`,
        'Content-Type': 'application/json',
      },
      body: jsonString,
    })
    
    if (!resp.ok) {
        console.error('Save DB Failed:', await resp.text())
    }
  } catch (e) {
    console.error('Save DB error:', e)
  }
}

export const store = {
  getAll: async (): Promise<ImageRecord[]> => {
    if (memoryCache) return memoryCache
    const data = await fetchDB()
    memoryCache = data
    return data
  },

  add: async (record: ImageRecord) => {
    let list = await store.getAll()
    list.unshift(record)
    if (list.length > 2000) list.pop()
    memoryCache = list
    // [修复] 必须 await，否则 Serverless 进程冻结会导致保存失败
    await saveDB(list)
  },

  remove: async (id: string) => {
    let list = await store.getAll()
    const newList = list.filter(item => item.id !== id)
    memoryCache = newList
    // [修复] 必须 await
    await saveDB(newList)
  }
}
