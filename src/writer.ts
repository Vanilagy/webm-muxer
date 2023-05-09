import { EBML, EBMLFloat32, EBMLFloat64, measureEBMLVarInt, measureUnsignedInt } from './ebml';
import { ArrayBufferTarget, FileSystemWritableFileStreamTarget, StreamTarget } from './target';

export abstract class Writer {
	pos = 0;
	#helper = new Uint8Array(8);
	#helperView = new DataView(this.#helper.buffer);

	/**
	 * Stores the position from the start of the file to where EBML elements have been written. This is used to
	 * rewrite/edit elements that were already added before, and to measure sizes of things.
	 */
	offsets = new WeakMap<EBML, number>();
	/** Same as offsets, but stores position where the element's data starts (after ID and size fields). */
	dataOffsets = new WeakMap<EBML, number>();

	/** Writes the given data to the target, at the current position. */
	abstract write(data: Uint8Array): void;
	/** Called after muxing has finished. */
	abstract finalize(): void;

	/** Sets the current position for future writes to a new one. */
	seek(newPos: number) {
		this.pos = newPos;
	}

	#writeByte(value: number) {
		this.#helperView.setUint8(0, value);
		this.write(this.#helper.subarray(0, 1));
	}

	#writeFloat32(value: number) {
		this.#helperView.setFloat32(0, value, false);
		this.write(this.#helper.subarray(0, 4));
	}

	#writeFloat64(value: number) {
		this.#helperView.setFloat64(0, value, false);
		this.write(this.#helper);
	}

	#writeUnsignedInt(value: number, width: number = measureUnsignedInt(value)) {
		let pos = 0;

		// Each case falls through:
		switch (width) {
			case 6:
				// Need to use division to access >32 bits of floating point var
				this.#helperView.setUint8(pos++, (value / 2**40) | 0);
			case 5:
				this.#helperView.setUint8(pos++, (value / 2**32) | 0);
			case 4:
				this.#helperView.setUint8(pos++, value >> 24);
			case 3:
				this.#helperView.setUint8(pos++, value >> 16);
			case 2:
				this.#helperView.setUint8(pos++, value >> 8);
			case 1:
				this.#helperView.setUint8(pos++, value);
				break;
			default:
				throw new Error('Bad UINT size ' + width);
		}

		this.write(this.#helper.subarray(0, pos));
	}

	writeEBMLVarInt(value: number, width: number = measureEBMLVarInt(value)) {
		let pos = 0;

		switch (width) {
			case 1:
				this.#helperView.setUint8(pos++, (1 << 7) | value);
				break;
			case 2:
				this.#helperView.setUint8(pos++, (1 << 6) | (value >> 8));
				this.#helperView.setUint8(pos++, value);
				break;
			case 3:
				this.#helperView.setUint8(pos++, (1 << 5) | (value >> 16));
				this.#helperView.setUint8(pos++, value >> 8);
				this.#helperView.setUint8(pos++, value);
				break;
			case 4:
				this.#helperView.setUint8(pos++, (1 << 4) | (value >> 24));
				this.#helperView.setUint8(pos++, value >> 16);
				this.#helperView.setUint8(pos++, value >> 8);
				this.#helperView.setUint8(pos++, value);
				break;
			case 5:
				/**
				 * JavaScript converts its doubles to 32-bit integers for bitwise
				 * operations, so we need to do a division by 2^32 instead of a
				 * right-shift of 32 to retain those top 3 bits
				 */
				this.#helperView.setUint8(pos++, (1 << 3) | ((value / 2**32) & 0x7));
				this.#helperView.setUint8(pos++, value >> 24);
				this.#helperView.setUint8(pos++, value >> 16);
				this.#helperView.setUint8(pos++, value >> 8);
				this.#helperView.setUint8(pos++, value);
				break;
			case 6:
				this.#helperView.setUint8(pos++, (1 << 2) | ((value / 2**40) & 0x3));
				this.#helperView.setUint8(pos++, (value / 2**32) | 0);
				this.#helperView.setUint8(pos++, value >> 24);
				this.#helperView.setUint8(pos++, value >> 16);
				this.#helperView.setUint8(pos++, value >> 8);
				this.#helperView.setUint8(pos++, value);
				break;
			default:
				throw new Error('Bad EBML VINT size ' + width);
		}

		this.write(this.#helper.subarray(0, pos));
	}

	// Assumes the string is ASCII
	#writeString(str: string) {
		this.write(new Uint8Array(str.split('').map(x => x.charCodeAt(0))));
	}

	writeEBML(data: EBML) {
		if (data === null) return;

		if (data instanceof Uint8Array) {
			this.write(data);
		} else if (Array.isArray(data)) {
			for (let elem of data) {
				this.writeEBML(elem);
			}
		} else {
			this.offsets.set(data, this.pos);

			this.#writeUnsignedInt(data.id); // ID field

			if (Array.isArray(data.data)) {
				let sizePos = this.pos;
				let sizeSize = data.size === -1 ? 1 : (data.size ?? 4);

				if (data.size === -1) {
					// Write the reserved all-one-bits marker for unknown/unbounded size.
					this.#writeByte(0xff);
				} else {
					this.seek(this.pos + sizeSize);
				}

				let startPos = this.pos;
				this.dataOffsets.set(data, startPos);
				this.writeEBML(data.data);

				if (data.size !== -1) {
					let size = this.pos - startPos;
					let endPos = this.pos;
					this.seek(sizePos);
					this.writeEBMLVarInt(size, sizeSize);
					this.seek(endPos);
				}
			} else if (typeof data.data === 'number') {
				let size = data.size ?? measureUnsignedInt(data.data);
				this.writeEBMLVarInt(size);
				this.#writeUnsignedInt(data.data, size);
			} else if (typeof data.data === 'string') {
				this.writeEBMLVarInt(data.data.length);
				this.#writeString(data.data);
			} else if (data.data instanceof Uint8Array) {
				this.writeEBMLVarInt(data.data.byteLength, data.size);
				this.write(data.data);
			} else if (data.data instanceof EBMLFloat32) {
				this.writeEBMLVarInt(4);
				this.#writeFloat32(data.data.value);
			} else if (data.data instanceof EBMLFloat64) {
				this.writeEBMLVarInt(8);
				this.#writeFloat64(data.data.value);
			}
		}
	}
}

/**
 * Writes to an ArrayBufferTarget. Maintains a growable internal buffer during the muxing process, which will then be
 * written to the ArrayBufferTarget once the muxing finishes.
 */
export class ArrayBufferTargetWriter extends Writer {
	#target: ArrayBufferTarget;
	#buffer = new ArrayBuffer(2**16);
	#bytes = new Uint8Array(this.#buffer);

	constructor(target: ArrayBufferTarget) {
		super();

		this.#target = target;
	}

	#ensureSize(size: number) {
		let newLength = this.#buffer.byteLength;
		while (newLength < size) newLength *= 2;

		if (newLength === this.#buffer.byteLength) return;

		let newBuffer = new ArrayBuffer(newLength);
		let newBytes = new Uint8Array(newBuffer);
		newBytes.set(this.#bytes, 0);

		this.#buffer = newBuffer;
		this.#bytes = newBytes;
	}

	write(data: Uint8Array) {
		this.#ensureSize(this.pos + data.byteLength);

		this.#bytes.set(data, this.pos);
		this.pos += data.byteLength;
	}

	finalize() {
		this.#ensureSize(this.pos);
		this.#target.buffer = this.#buffer.slice(0, this.pos);
	}
}

/**
 * Writes to a StreamTarget every time it is flushed, sending out all of the new data written since the
 * last flush. This is useful for streaming applications, like piping the output to disk.
 */
export class StreamTargetWriter extends Writer {
	#target: StreamTarget;
	#sections: {
		data: Uint8Array,
		start: number
	}[] = [];

	#lastFlushEnd = 0;
	#ensureMonotonicity: boolean;

	constructor(target: StreamTarget, ensureMonotonicity: boolean) {
		super();

		this.#target = target;
		this.#ensureMonotonicity = ensureMonotonicity;
	}

	write(data: Uint8Array) {
		this.#sections.push({
			data: data.slice(),
			start: this.pos
		});
		this.pos += data.byteLength;
	}

	flush() {
		if (this.#sections.length === 0) return;

		let chunks: {
			start: number,
			size: number,
			data?: Uint8Array
		}[] = [];
		let sorted = [...this.#sections].sort((a, b) => a.start - b.start);

		chunks.push({
			start: sorted[0].start,
			size: sorted[0].data.byteLength
		});

		// Figure out how many contiguous chunks we have
		for (let i = 1; i < sorted.length; i++) {
			let lastChunk = chunks[chunks.length - 1];
			let section = sorted[i];

			if (section.start <= lastChunk.start + lastChunk.size) {
				lastChunk.size = Math.max(lastChunk.size, section.start + section.data.byteLength - lastChunk.start);
			} else {
				chunks.push({
					start: section.start,
					size: section.data.byteLength
				});
			}
		}

		for (let chunk of chunks) {
			chunk.data = new Uint8Array(chunk.size);

			// Make sure to write the data in the correct order for correct overwriting
			for (let section of this.#sections) {
				// Check if the section is in the chunk
				if (chunk.start <= section.start && section.start < chunk.start + chunk.size) {
					chunk.data.set(section.data, section.start - chunk.start);
				}
			}

			if (this.#ensureMonotonicity && chunk.start < this.#lastFlushEnd) {
				throw new Error('Internal error: Monotonicity violation.');
			}

			this.#target.onData(chunk.data, chunk.start);
			this.#lastFlushEnd = chunk.start + chunk.data.byteLength;
		}

		this.#sections.length = 0;
	}

	finalize() {
		this.#target.onDone?.();
	}
}

const DEFAULT_CHUNK_SIZE = 2**24;
const MAX_CHUNKS_AT_ONCE = 2;

interface Chunk {
	start: number,
	written: ChunkSection[],
	data: Uint8Array,
	shouldFlush: boolean
}

interface ChunkSection {
	start: number,
	end: number
}

/**
 * Writes to a StreamTarget using a chunked approach: Data is first buffered in memory until it reaches a large enough
 * size, which is when it is piped to the StreamTarget. This is helpful for reducing the total amount of writes.
 */
export class ChunkedStreamTargetWriter extends Writer {
	#target: StreamTarget;
	#chunkSize: number;
	/**
	 * The data is divided up into fixed-size chunks, whose contents are first filled in RAM and then flushed out.
	 * A chunk is flushed if all of its contents have been written.
	 */
	#chunks: Chunk[] = [];

	#lastFlushEnd = 0;
	#ensureMonotonicity: boolean;

	constructor(target: StreamTarget, ensureMonotonicity: boolean) {
		super();

		this.#target = target;
		this.#chunkSize = target.options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
		this.#ensureMonotonicity = ensureMonotonicity;

		if (!Number.isInteger(this.#chunkSize) || this.#chunkSize < 2**10) {
			throw new Error('Invalid StreamTarget options: chunkSize must be an integer not smaller than 1024.');
		}
	}

	write(data: Uint8Array) {
		this.#writeDataIntoChunks(data, this.pos);
		this.#flushChunks();

		this.pos += data.byteLength;
	}

	#writeDataIntoChunks(data: Uint8Array, position: number) {
		// First, find the chunk to write the data into, or create one if none exists
		let chunkIndex = this.#chunks.findIndex(x => x.start <= position && position < x.start + this.#chunkSize);
		if (chunkIndex === -1) chunkIndex = this.#createChunk(position);
		let chunk = this.#chunks[chunkIndex];

		// Figure out how much to write to the chunk, and then write to the chunk
		let relativePosition = position - chunk.start;
		let toWrite = data.subarray(0, Math.min(this.#chunkSize - relativePosition, data.byteLength));
		chunk.data.set(toWrite, relativePosition);

		// Create a section describing the region of data that was just written to
		let section: ChunkSection = {
			start: relativePosition,
			end: relativePosition + toWrite.byteLength
		};
		this.#insertSectionIntoChunk(chunk, section);

		// Queue chunk for flushing to target if it has been fully written to
		if (chunk.written[0].start === 0 && chunk.written[0].end === this.#chunkSize) {
			chunk.shouldFlush = true;
		}

		// Make sure we don't hold too many chunks in memory at once to keep memory usage down
		if (this.#chunks.length > MAX_CHUNKS_AT_ONCE) {
			// Flush all but the last chunk
			for (let i = 0; i < this.#chunks.length-1; i++) {
				this.#chunks[i].shouldFlush = true;
			}
			this.#flushChunks();
		}

		// If the data didn't fit in one chunk, recurse with the remaining datas
		if (toWrite.byteLength < data.byteLength) {
			this.#writeDataIntoChunks(data.subarray(toWrite.byteLength), position + toWrite.byteLength);
		}
	}

	#insertSectionIntoChunk(chunk: Chunk, section: ChunkSection) {
		let low = 0;
		let high = chunk.written.length - 1;
		let index = -1;

		// Do a binary search to find the last section with a start not larger than `section`'s start
		while (low <= high) {
			let mid = Math.floor(low + (high - low + 1) / 2);

			if (chunk.written[mid].start <= section.start) {
				low = mid + 1;
				index = mid;
			} else {
				high = mid - 1;
			}
		}

		// Insert the new section
		chunk.written.splice(index + 1, 0, section);
		if (index === -1 || chunk.written[index].end < section.start) index++;

		// Merge overlapping sections
		while (index < chunk.written.length - 1 && chunk.written[index].end >= chunk.written[index + 1].start) {
			chunk.written[index].end = Math.max(chunk.written[index].end, chunk.written[index + 1].end);
			chunk.written.splice(index + 1, 1);
		}
	}

	#createChunk(includesPosition: number) {
		let start = Math.floor(includesPosition / this.#chunkSize) * this.#chunkSize;
		let chunk: Chunk = {
			start,
			data: new Uint8Array(this.#chunkSize),
			written: [],
			shouldFlush: false
		};
		this.#chunks.push(chunk);
		this.#chunks.sort((a, b) => a.start - b.start);

		return this.#chunks.indexOf(chunk);
	}

	#flushChunks(force = false) {
		for (let i = 0; i < this.#chunks.length; i++) {
			let chunk = this.#chunks[i];
			if (!chunk.shouldFlush && !force) continue;

			for (let section of chunk.written) {
				if (this.#ensureMonotonicity && chunk.start + section.start < this.#lastFlushEnd) {
					throw new Error('Internal error: Monotonicity violation.');
				}

				this.#target.onData(
					chunk.data.subarray(section.start, section.end),
					chunk.start + section.start
				);
				this.#lastFlushEnd = chunk.start + section.end;
			}
			this.#chunks.splice(i--, 1);
		}
	}

	finalize() {
		this.#flushChunks(true);
		this.#target.onDone?.();
	}
}

/**
 * Essentially a wrapper around ChunkedStreamTargetWriter, writing directly to disk using the File System Access API.
 * This is useful for large files, as available RAM is no longer a bottleneck.
 */
export class FileSystemWritableFileStreamTargetWriter extends ChunkedStreamTargetWriter {
	constructor(target: FileSystemWritableFileStreamTarget, ensureMonotonicity: boolean) {
		super(new StreamTarget(
			(data, position) => target.stream.write({
				type: 'write',
				data,
				position
			}),
			undefined,
			{ chunkSize: target.options?.chunkSize }
		), ensureMonotonicity);
	}
}