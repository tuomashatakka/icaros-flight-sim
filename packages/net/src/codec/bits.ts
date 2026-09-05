/**
 * Bit-level reads and writes over an `ArrayBuffer`.
 *
 * The hot path is quantised, and quantised values are not byte-aligned: a
 * smallest-three quaternion is 32 bits made of a 2-bit index and three 10-bit
 * components, and rounding each of those up to a byte would throw away most of
 * what the compression bought. So everything goes through here.
 *
 * Little-endian bit order within each byte, low bits first. The choice is
 * arbitrary; what matters is that the reader and the writer agree, and they do
 * because they are the same forty lines mirrored.
 */

const GROWTH = 2

export class BitWriter {
  private bytes: Uint8Array
  private bitPos = 0

  constructor (capacity = 512) {
    this.bytes = new Uint8Array(capacity)
  }

  private ensure (byteIndex: number): void {
    if (byteIndex < this.bytes.length)
      return

    const grown = new Uint8Array(Math.max(byteIndex + 1, this.bytes.length * GROWTH))
    grown.set(this.bytes)
    this.bytes = grown
  }

  /** `bits` must be 1..32; `value` is treated as unsigned. */
  writeBits (value: number, bits: number): void {
    let remaining = bits
    let rest      = value >>> 0

    while (remaining > 0) {
      const byteIndex = this.bitPos >> 3
      const offset    = this.bitPos & 7
      const take      = Math.min(8 - offset, remaining)

      this.ensure(byteIndex)
      this.bytes[byteIndex] |= ((rest & ((1 << take) - 1)) << offset) & 0xff

      rest      >>>= take
      remaining  -= take
      this.bitPos += take
    }
  }

  writeBool (value: boolean): void {
    this.writeBits(value ? 1 : 0, 1)
  }

  /** Two's complement in `bits` bits. The caller owns the range check. */
  writeSigned (value: number, bits: number): void {
    this.writeBits(value < 0 ? value + (1 << bits) : value, bits)
  }

  writeFloat32 (value: number): void {
    const scratch = new DataView(new ArrayBuffer(4))
    scratch.setFloat32(0, value, true)
    this.writeBits(scratch.getUint32(0, true), 32)
  }

  /** Split rather than a 64-bit path: JS bitwise ops stop being exact at 2^32. */
  writeFloat64 (value: number): void {
    const scratch = new DataView(new ArrayBuffer(8))
    scratch.setFloat64(0, value, true)
    this.writeBits(scratch.getUint32(0, true), 32)
    this.writeBits(scratch.getUint32(4, true), 32)
  }

  /** Length-prefixed UTF-8. Names only — nothing hot enough to want a table. */
  writeString (value: string, maxBytes = 255): void {
    const encoded = new TextEncoder().encode(value).subarray(0, maxBytes)
    this.writeBits(encoded.length, 8)
    for (const byte of encoded)
      this.writeBits(byte, 8)
  }

  get bitLength (): number {
    return this.bitPos
  }

  get byteLength (): number {
    return (this.bitPos + 7) >> 3
  }

  /** A copy, sized to what was written. Safe to hand to `send()`. */
  finish (): Uint8Array {
    return this.bytes.slice(0, this.byteLength)
  }
}


export class BitReader {
  private bitPos = 0

  constructor (private readonly bytes: Uint8Array) {}

  readBits (bits: number): number {
    let remaining = bits
    let shift     = 0
    let value     = 0

    while (remaining > 0) {
      const byteIndex = this.bitPos >> 3
      const offset    = this.bitPos & 7
      const take      = Math.min(8 - offset, remaining)
      const byte      = byteIndex < this.bytes.length ? this.bytes[byteIndex] : 0
      const chunk     = (byte >>> offset) & ((1 << take) - 1)

      // `|` would sign-flip at bit 31; the unsigned add cannot.
      value      += chunk * 2 ** shift
      shift      += take
      remaining  -= take
      this.bitPos += take
    }

    return value >>> 0
  }

  readBool (): boolean {
    return this.readBits(1) === 1
  }

  readSigned (bits: number): number {
    const raw = this.readBits(bits)
    return raw >= 1 << (bits - 1) ? raw - (1 << bits) : raw
  }

  readFloat32 (): number {
    const scratch = new DataView(new ArrayBuffer(4))
    scratch.setUint32(0, this.readBits(32), true)
    return scratch.getFloat32(0, true)
  }

  readFloat64 (): number {
    const scratch = new DataView(new ArrayBuffer(8))
    scratch.setUint32(0, this.readBits(32), true)
    scratch.setUint32(4, this.readBits(32), true)
    return scratch.getFloat64(0, true)
  }

  readString (): string {
    const length = this.readBits(8)
    const out    = new Uint8Array(length)
    for (let i = 0; i < length; i++)
      out[i] = this.readBits(8)
    return new TextDecoder().decode(out)
  }

  get bitsRead (): number {
    return this.bitPos
  }

  get exhausted (): boolean {
    return this.bitPos >= this.bytes.length * 8
  }
}
