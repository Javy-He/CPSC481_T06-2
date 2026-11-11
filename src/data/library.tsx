import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  loadLibrary,
  patchCollection,
  patchImage,
  persist,
  putCollection,
  putImages,
  removeCollection,
  syncImages,
  type CollectionRecord,
  type ImageMeta,
  type ImageRecord,
} from './db'

export type LibraryImage = {
  id: string
  title: string
  description: string
  src: string | null // null = grey placeholder tile
  thumbSrc: string | null // small copy used in grids
  aspectRatio: number // width / height
  forSale: boolean
  price: number | null
  format?: string
  width?: number
  height?: number
  fileSize?: number
}

export type Collection = {
  id: string
  name: string
  info: string
  isPrivate: boolean
  images: LibraryImage[]
}

const THUMB_SIZE = 480

type Thumbnail = {
  src: string
  thumbSrc: string
  thumbBlob: Blob | null // the small copy, stored in the database
  aspectRatio: number
  width?: number
  height?: number
}

// Generate smaller thumbnails so large images don't slow down the UI.
async function makeThumbnail(file: File): Promise<Thumbnail> {
  const fullSrc = URL.createObjectURL(file)

  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap

    const scale = Math.min(
      1,
      THUMB_SIZE / Math.max(width, height)
    )

    const canvas = document.createElement('canvas')

    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)

    canvas
      .getContext('2d')!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85)
    )

    return {
      src: fullSrc,
      thumbSrc: blob ? URL.createObjectURL(blob) : fullSrc,
      thumbBlob: blob,
      aspectRatio: width / height,
      width,
      height,
    }
  } catch {
    // Unsupported image formats fall back to the original file.
    return {
      src: fullSrc,
      thumbSrc: fullSrc,
      thumbBlob: null,
      aspectRatio: 1,
    }
  }
}

// ========================================
// SAMPLE PHOTOS
// ========================================

// Each sample photo has a pre-generated thumbnail.
const sampleUrls = import.meta.glob<string>(
  '../assets/images/*/*.jpg',
  {
    eager: true,
    query: '?url',
    import: 'default',
  }
)

const LANDSCAPE = 3 / 2
const PORTRAIT = 2 / 3

type SamplePhoto = [string, number]

const COLLECTION_1: SamplePhoto[] = [
  ['collection1/DSC00013', LANDSCAPE],
  ['collection1/DSC00098', LANDSCAPE],
  ['collection1/DSC00459', PORTRAIT],
  ['collection1/DSC00668', PORTRAIT],
  ['collection1/DSC00988', LANDSCAPE],
  ['collection1/DSC01203', 3723 / 5630],
  ['collection1/DSC01503', LANDSCAPE],
  ['collection1/DSC01538', LANDSCAPE],
  ['collection1/DSC01662', 3874 / 5922],
  ['collection1/DSC01743', PORTRAIT],
  ['collection1/DSC01755', PORTRAIT],
]

const COLLECTION_2: SamplePhoto[] = [
  ['collection2/20230723_0102', LANDSCAPE],
  ['collection2/20230828_0269', LANDSCAPE],
  ['collection2/20230828_0389', LANDSCAPE],
  ['collection2/20230916_0012', LANDSCAPE],
  ['collection2/20230916_0022', LANDSCAPE],
  ['collection2/20230916_0131', LANDSCAPE],
]

const COLLECTION_3: SamplePhoto[] = [
  ['collection3/20241119_0055', LANDSCAPE],
  ['collection3/20241119_0124', LANDSCAPE],
  ['collection3/20241119_0155', 5969 / 3948],
  ['collection3/20241119_0186', LANDSCAPE],
  ['collection3/20241119_0189', LANDSCAPE],
  ['collection3/20241119_0230', LANDSCAPE],
  ['collection3/20241119_0331', LANDSCAPE],
]

// Text for the sample photos. Fill in any title or description; a blank title falls back to the file name
const SAMPLE_TEXT: Record<string, { title: string; description: string }> = {
  // Spain/Portugal
  'collection1/DSC00013': { title: 'Rhonda', description: 'Farm field as viewed from the town of rhonda' },
  'collection1/DSC00098': { title: 'Farm Houses', description: '' },
  'collection1/DSC00459': { title: 'Arches', description: '' },
  'collection1/DSC00668': { title: 'Stained Glass', description: '' },
  'collection1/DSC00988': { title: 'Montserrat', description: '' },
  'collection1/DSC01203': { title: 'Sagrada Familia', description: 'Barcelona\'s most famous landmark' },
  'collection1/DSC01503': { title: 'Lisbon', description: '' },
  'collection1/DSC01538': { title: 'Sintra', description: 'The national palace in Sintra Portugal' },
  'collection1/DSC01662': { title: 'Cabo de Roca', description: '' },
  'collection1/DSC01743': { title: 'Cabo de Roca', description: '' },
  'collection1/DSC01755': { title: 'Cabo de Roca', description: '' },
  // Alberta
  'collection2/20230723_0102': { title: 'Not Alberta', description: '' },
  'collection2/20230828_0269': { title: 'Ram Canyon Rider', description: 'Mountain biker riding down the scree slopes of Ram Canyon' },
  'collection2/20230828_0389': { title: 'Ram Falls', description: '' },
  'collection2/20230916_0012': { title: 'Skoki 1', description: '' },
  'collection2/20230916_0022': { title: 'Skoki 2', description: '' },
  'collection2/20230916_0131': { title: 'Skoki 3', description: '' },
  // Patagonia
  'collection3/20241119_0055': { title: 'Glacier', description: 'Glacier in Torres del Paine' },
  'collection3/20241119_0124': { title: 'Torres del Paine', description: '' },
  'collection3/20241119_0155': { title: 'Argentine Glacier', description: '' },
  'collection3/20241119_0186': { title: 'Mount Fitz Roy 1', description: 'The iconic peak in Patagonia' },
  'collection3/20241119_0189': { title: 'Mount Fitz Roy 2', description: '' },
  'collection3/20241119_0230': { title: 'Mount Fitz Roy 3', description: '' },
  'collection3/20241119_0331': { title: 'Torres', description: 'The iconic Chilean granite towers' },
}

// Every 4th photo is for sale; borrowed photos pass sell = false so a photo isn't listed twice
function makeSamples(collectionId: string, photos: SamplePhoto[], sell = true): ImageRecord[] {
  return photos.map(([path, aspectRatio], i) => {
    const forSale = sell && i % 4 === 0

    return {
      id: `${collectionId}-img-${i + 1}`,
      collectionId,
      position: i,
      title: SAMPLE_TEXT[path]?.title || path.split('/')[1],
      description: SAMPLE_TEXT[path]?.description ?? '',
      sampleKey: path,
      aspectRatio,
      forSale,
      price: forSale ? 25 + i * 5 : null,
    }
  })
}

// ========================================
// SAMPLE DATA FOR THE DATABASE
// ========================================

// Written to the database the first time the app runs. Change this number
// whenever the sample data above changes, so browsers that saved an older
// version are reset to the new sample data.
const SEED_VERSION = 1

const seed = {
  collections: [
    { id: '1', name: 'Spain/Portugal', info: '', isPrivate: false, position: 0 },
    { id: '2', name: 'Alberta', info: '', isPrivate: false, position: 1 },
    { id: '3', name: 'Patagonia', info: '', isPrivate: false, position: 2 },
    { id: '5', name: 'Random', info: '', isPrivate: true, position: 3 },
  ] satisfies CollectionRecord[],
  images: [
    ...makeSamples('1', COLLECTION_1),
    ...makeSamples('2', COLLECTION_2),
    ...makeSamples('3', COLLECTION_3),
    ...makeSamples(
      '5',
      [
        COLLECTION_1[2],
        COLLECTION_2[0],
        COLLECTION_3[3],
        COLLECTION_1[7],
        COLLECTION_2[4],
      ],
      false
    ),
  ],
}

// ========================================
// DATABASE RECORDS <-> APP DATA
// ========================================

// Turns a stored record into the object the pages use. Uploaded photos
// get a fresh temporary URL, because those URLs don't survive a refresh.
function toImage(record: ImageRecord): LibraryImage {
  const base = {
    id: record.id,
    title: record.title,
    description: record.description,
    aspectRatio: record.aspectRatio,
    forSale: record.forSale,
    price: record.price,
    format: record.format,
    width: record.width,
    height: record.height,
    fileSize: record.fileSize,
  }

  if (record.fileBlob) {
    const src = URL.createObjectURL(record.fileBlob)

    return {
      ...base,
      src,
      thumbSrc: record.thumbBlob ? URL.createObjectURL(record.thumbBlob) : src,
    }
  }

  const key = record.sampleKey

  return {
    ...base,
    src: key ? sampleUrls[`../assets/images/${key}.jpg`] ?? null : null,
    thumbSrc: key ? sampleUrls[`../assets/images/${key}_thumb.jpg`] ?? null : null,
  }
}

function toCollections(
  collectionRecords: CollectionRecord[],
  imageRecords: ImageRecord[]
): Collection[] {
  return [...collectionRecords]
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      id: c.id,
      name: c.name,
      info: c.info,
      isPrivate: c.isPrivate,
      images: imageRecords
        .filter((image) => image.collectionId === c.id)
        .sort((a, b) => a.position - b.position)
        .map(toImage),
    }))
}

// Only these fields are saved for an image. The photo files themselves
// (src and thumbSrc) are never overwritten.
const META_KEYS = [
  'title',
  'description',
  'aspectRatio',
  'forSale',
  'price',
  'format',
  'width',
  'height',
  'fileSize',
] as const

function pickMeta(source: Partial<LibraryImage>): Partial<ImageMeta> {
  const picked: Record<string, unknown> = {}

  for (const key of META_KEYS) {
    if (source[key] !== undefined) picked[key] = source[key]
  }

  return picked as Partial<ImageMeta>
}

// Saves in the background. Failures are logged, and the page keeps working.
function save(task: () => Promise<unknown>) {
  persist(task).catch((error) =>
    console.error('Could not save to the database:', error)
  )
}

// ========================================
// LIBRARY CONTEXT
// ========================================

type LibraryContextValue = {
  collections: Collection[]

  getCollection: (id: string) => Collection | undefined

  addCollection: (
    name: string,
    isPrivate: boolean
  ) => Collection

  addImages: (
    collectionId: string,
    files: File[]
  ) => Promise<void>

  updateCollection: (
    collectionId: string,
    changes: Partial<Omit<Collection, 'id'>>
  ) => void

  deleteCollection: (collectionId: string) => void

  updateImage: (
    collectionId: string,
    imageId: string,
    changes: Partial<Omit<LibraryImage, 'id'>>
  ) => void

  // Erases everything saved in the browser and restores the sample data.
  resetLibrary: () => Promise<void>
}

const LibraryContext = createContext<LibraryContextValue | null>(null)

// ========================================
// LIBRARY PROVIDER
// ========================================

export function LibraryProvider({
  children,
}: {
  children: ReactNode
}) {
  const [collections, setCollections] = useState<Collection[]>([])
  const [ready, setReady] = useState(false)

  // ========================================
  // LOAD FROM THE DATABASE
  // ========================================

  useEffect(() => {
    let cancelled = false

    loadLibrary(seed, SEED_VERSION)
      .then(({ collectionRecords, imageRecords }) =>
        toCollections(collectionRecords, imageRecords)
      )
      .catch((error) => {
        // No database available: use the sample data without saving.
        console.warn('Database unavailable, data will not be saved:', error)
        return toCollections(seed.collections, seed.images)
      })
      .then((loaded) => {
        if (cancelled) return
        setCollections(loaded)
        setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // ========================================
  // GET COLLECTION
  // ========================================

  const getCollection = useCallback(
    (id: string) => {
      return collections.find((c) => c.id === id)
    },
    [collections]
  )

  // ========================================
  // ADD COLLECTION
  // ========================================

  const addCollection = useCallback(
    (name: string, isPrivate: boolean): Collection => {
      const newCollection: Collection = {
        id: crypto.randomUUID(),
        name,
        info: '',
        isPrivate,
        images: [],
      }

      setCollections((prev) => [
        ...prev,
        newCollection,
      ])

      // Using the time as the position keeps new collections after the
      // sample ones, in the order they were created.
      save(() =>
        putCollection({
          id: newCollection.id,
          name,
          info: '',
          isPrivate,
          position: Date.now(),
        })
      )

      // Return the new collection so the page can
      // navigate directly to its upload screen.
      return newCollection
    },
    []
  )

  // ========================================
  // ADD IMAGES
  // ========================================

  const addImages = useCallback(
    async (collectionId: string, files: File[]) => {
      const stamp = Date.now()

      const thumbnails = await Promise.all(
        files.map(makeThumbnail)
      )

      const records: ImageRecord[] = files.map((file, i) => ({
        id: `${collectionId}-${stamp}-${i}`,
        collectionId,
        position: stamp + i, // after every earlier photo in the collection
        title: file.name.replace(/\.[^.]+$/, ''),
        description: '',
        aspectRatio: thumbnails[i].aspectRatio,
        width: thumbnails[i].width,
        height: thumbnails[i].height,
        format:
          file.type.split('/')[1]?.toUpperCase() ||
          file.name.split('.').pop()?.toUpperCase() ||
          'Unknown',
        fileSize: file.size,
        forSale: false,
        price: null,
        fileBlob: file,
        thumbBlob: thumbnails[i].thumbBlob ?? undefined,
      }))

      // Save before showing the photos. If saving fails (for example the
      // browser's storage is full), the upload page shows its error message
      // instead of the photos silently disappearing after a refresh.
      await persist(() => putImages(records))

      const newImages: LibraryImage[] = records.map((record, i) => ({
        id: record.id,
        title: record.title,
        description: '',
        src: thumbnails[i].src,
        thumbSrc: thumbnails[i].thumbSrc,
        aspectRatio: record.aspectRatio,
        width: record.width,
        height: record.height,
        format: record.format,
        fileSize: record.fileSize,
        forSale: false,
        price: null,
      }))

      setCollections((prev) =>
        prev.map((c) =>
          c.id === collectionId
            ? {
                ...c,
                images: [
                  ...c.images,
                  ...newImages,
                ],
              }
            : c
        )
      )
    },
    []
  )

  // ========================================
  // UPDATE COLLECTION
  // ========================================

  const updateCollection = useCallback(
    (
      collectionId: string,
      changes: Partial<Omit<Collection, 'id'>>
    ) => {
      setCollections((prev) =>
        prev.map((c) =>
          c.id === collectionId
            ? { ...c, ...changes }
            : c
        )
      )

      const { name, info, isPrivate, images } = changes

      save(async () => {
        await patchCollection(collectionId, { name, info, isPrivate })

        // The edit page sends the full photo list, so this also saves
        // reordering and photos that were removed.
        if (images) {
          await syncImages(
            collectionId,
            images.map((image) => ({ id: image.id, ...pickMeta(image) }))
          )
        }
      })
    },
    []
  )

  // ========================================
  // DELETE COLLECTION
  // ========================================

  const deleteCollection = useCallback(
    (collectionId: string) => {
      setCollections((prev) =>
        prev.filter((c) => c.id !== collectionId)
      )

      save(() => removeCollection(collectionId))
    },
    []
  )

  // ========================================
  // UPDATE IMAGE
  // ========================================

  const updateImage = useCallback(
    (
      collectionId: string,
      imageId: string,
      changes: Partial<Omit<LibraryImage, 'id'>>
    ) => {
      setCollections((prev) =>
        prev.map((c) =>
          c.id !== collectionId
            ? c
            : {
                ...c,
                images: c.images.map((img) =>
                  img.id === imageId
                    ? { ...img, ...changes }
                    : img
                ),
              }
        )
      )

      save(() => patchImage(imageId, pickMeta(changes)))
    },
    []
  )

  // ========================================
  // RESET LIBRARY
  // ========================================

  const resetLibrary = useCallback(async () => {
    try {
      await persist(() => loadLibrary(seed, SEED_VERSION, true))
    } catch (error) {
      console.error('Could not reset the database:', error)
    }

    setCollections(toCollections(seed.collections, seed.images))
  }, [])

  // ========================================
  // PROVIDER
  // ========================================

  // Wait for the saved data so pages never flash "not found".
  if (!ready) return null

  return (
    <LibraryContext.Provider
      value={{
        collections,
        getCollection,
        addCollection,
        addImages,
        updateCollection,
        deleteCollection,
        updateImage,
        resetLibrary,
      }}
    >
      {children}
    </LibraryContext.Provider>
  )
}

// ========================================
// USE LIBRARY HOOK
// ========================================

export function useLibrary() {
  const ctx = useContext(LibraryContext)

  if (!ctx) {
    throw new Error(
      'useLibrary must be used inside <LibraryProvider>'
    )
  }

  return ctx
}
