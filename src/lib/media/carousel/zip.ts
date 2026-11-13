import { crc32 } from 'node:zlib'

/**
 * Files in one ZIP archive, for "Download all slides". The slides are PNG
 * and JPEG, which compress no further, so every file is stored as it is
 * (method 0) and the archive needs nothing beyond a CRC. Pure: no file
 * system. Names are marked UTF-8 (general purpose flag bit 11).
 */

export interface ZipEntry {
  name: string
  data: Buffer
  /** Shown as the file's modified time; now when absent. */
  date?: Date
}

const UTF8_FLAG = 0x0800
/** 2.0: the oldest version that reads stored files in folders. */
const VERSION = 20
const MAX_32 = 0xffffffff

/** The time and date as MS-DOS stores them: two-second steps, from 1980. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107)
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

export function zipFiles(files: ZipEntry[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const now = new Date()

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    if (name.length === 0 || name.length > 0xffff) {
      throw new Error(
        `A file in a ZIP needs a name of 1 to 65535 bytes: "${file.name}".`
      )
    }
    if (file.data.length > MAX_32 || offset > MAX_32) {
      throw new Error(
        'The ZIP is too large: a file or the archive is over 4 GB.'
      )
    }
    const crc = crc32(file.data) >>> 0
    const stamp = dosDateTime(file.date ?? now)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(UTF8_FLAG, 6)
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(file.data.length, 18) // compressed size
    local.writeUInt32LE(file.data.length, 22) // uncompressed size
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // no extra field

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(VERSION, 4) // made by
    entry.writeUInt16LE(VERSION, 6) // needed
    entry.writeUInt16LE(UTF8_FLAG, 8)
    entry.writeUInt16LE(0, 10)
    entry.writeUInt16LE(stamp.time, 12)
    entry.writeUInt16LE(stamp.date, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(file.data.length, 20)
    entry.writeUInt32LE(file.data.length, 24)
    entry.writeUInt16LE(name.length, 28)
    // Extra field, comment, disk number, internal and external attributes: none.
    entry.writeUInt32LE(offset, 42)

    parts.push(local, name, file.data)
    central.push(entry, name)
    offset += local.length + name.length + file.data.length
  }

  const directory = Buffer.concat(central)
  if (offset > MAX_32 || files.length > 0xffff) {
    throw new Error('The ZIP is too large for this writer.')
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // the directory's disk
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // no comment

  return Buffer.concat([...parts, directory, end])
}
