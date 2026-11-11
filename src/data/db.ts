import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

// ========================================
// RECORD TYPES (what is stored in the database)
// ========================================

export type CollectionRecord = {
  id: string
  name: string
  info: string
  isPrivate: boolean
  position: number // collections are shown in ascending position order
}

export type ImageRecord = {
  id: string
  collectionId: string
  position: number // images are shown in ascending position order
  title: string
  description: string
  aspectRatio: number
  forSale: boolean
  price: number | null
  format?: string
  width?: number
  height?: number
  fileSize?: number
  // A bundled sample photo. The URL is looked up when the app loads,
  // because the built file names change every time the site is rebuilt.
  sampleKey?: string
  // An uploaded photo, stored as files inside the database.
  fileBlob?: Blob
  thumbBlob?: Blob
}

export type ImageMeta = Pick<
  ImageRecord,
  | 'title'
  | 'description'
  | 'aspectRatio'
  | 'forSale'
  | 'price'
  | 'format'
  | 'width'
  | 'height'
  | 'fileSize'
>

interface LibrarySchema extends DBSchema {
  collections: { key: string; value: CollectionRecord }
  images: {
    key: string
    value: ImageRecord
    indexes: { 'by-collection': string }
  }
  meta: { key: string; value: number }
}

type Db = IDBPDatabase<LibrarySchema>

// ========================================
// OPENING THE DATABASE
// ========================================

const DB_NAME = 'photography-library-manager'
const DB_VERSION = 1

let dbPromise: Promise<Db> | null = null

// False once the browser refuses to open the database (for example some
// private-browsing modes). The app then keeps working in memory only.
let available = true

function getDb(): Promise<Db> {
  // The async wrapper turns an immediate error (a browser with no
  // IndexedDB at all) into a rejected promise, like any other failure.
  dbPromise ??= (async () =>
    openDB<LibrarySchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('collections', { keyPath: 'id' })

        const images = db.createObjectStore('images', { keyPath: 'id' })
        images.createIndex('by-collection', 'collectionId')

        db.createObjectStore('meta')
      },
    }))().catch((error) => {
    available = false
    throw error
  })

  return dbPromise
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>
}

// ========================================
// WRITE QUEUE
// ========================================

// Saves run one after another, so they reach the database in the same
// order the user made them.
let queue: Promise<unknown> = Promise.resolve()

export function persist<T>(task: () => Promise<T>): Promise<T | undefined> {
  if (!available) return Promise.resolve(undefined)

  const run = queue.then(task)
  queue = run.catch(() => undefined) // a failed save must not block the next one

  return run
}

// ========================================
// LOADING
// ========================================

type Seed = { collections: CollectionRecord[]; images: ImageRecord[] }

// Returns everything in the database. The first time the app runs (or
// when the seed version changes, or when force is true) the database is
// filled with the sample data first.
export async function loadLibrary(seed: Seed, seedVersion: number, force = false) {
  const db = await getDb()
  const tx = db.transaction(['collections', 'images', 'meta'], 'readwrite')
  const collections = tx.objectStore('collections')
  const images = tx.objectStore('images')
  const meta = tx.objectStore('meta')

  const storedVersion = await meta.get('seedVersion')

  if (force || storedVersion !== seedVersion) {
    await Promise.all([collections.clear(), images.clear()])
    seed.collections.forEach((c) => collections.put(c))
    seed.images.forEach((i) => images.put(i))
    meta.put(seedVersion, 'seedVersion')
  }

  const [collectionRecords, imageRecords] = await Promise.all([
    collections.getAll(),
    images.getAll(),
    tx.done,
  ])

  return { collectionRecords, imageRecords }
}

// ========================================
// COLLECTIONS
// ========================================

export async function putCollection(record: CollectionRecord) {
  const db = await getDb()
  await db.put('collections', record)
}

export async function patchCollection(
  id: string,
  changes: Partial<Pick<CollectionRecord, 'name' | 'info' | 'isPrivate'>>,
) {
  const db = await getDb()
  const tx = db.transaction('collections', 'readwrite')
  const existing = await tx.store.get(id)

  if (existing) await tx.store.put({ ...existing, ...withoutUndefined(changes), id })
  await tx.done
}

// Removes a collection and all of its photos.
export async function removeCollection(id: string) {
  const db = await getDb()
  const tx = db.transaction(['collections', 'images'], 'readwrite')
  const images = tx.objectStore('images')
  const keys = await images.index('by-collection').getAllKeys(id)

  await Promise.all([
    tx.objectStore('collections').delete(id),
    ...keys.map((key) => images.delete(key)),
    tx.done,
  ])
}

// ========================================
// IMAGES
// ========================================

export async function putImages(records: ImageRecord[]) {
  const db = await getDb()
  const tx = db.transaction('images', 'readwrite')

  await Promise.all([...records.map((r) => tx.store.put(r)), tx.done])
}

// Changes text and sale details but keeps the stored photo files.
export async function patchImage(id: string, changes: Partial<ImageMeta>) {
  const db = await getDb()
  const tx = db.transaction('images', 'readwrite')
  const existing = await tx.store.get(id)

  if (existing) await tx.store.put({ ...existing, ...withoutUndefined(changes), id })
  await tx.done
}

// Makes a collection's photos match the given list: photos that are no
// longer listed are deleted, and the rest are saved in the listed order.
export async function syncImages(
  collectionId: string,
  ordered: Array<{ id: string } & Partial<ImageMeta>>,
) {
  const db = await getDb()
  const tx = db.transaction('images', 'readwrite')
  const store = tx.store
  const keep = new Set(ordered.map((image) => image.id))

  const storedKeys = await store.index('by-collection').getAllKeys(collectionId)
  const writes: Promise<unknown>[] = storedKeys
    .filter((key) => !keep.has(key))
    .map((key) => store.delete(key))

  for (const [position, { id, ...meta }] of ordered.entries()) {
    const existing = await store.get(id)

    if (existing) {
      writes.push(store.put({ ...existing, ...withoutUndefined(meta), id, position }))
    }
  }

  await Promise.all([...writes, tx.done])
}
