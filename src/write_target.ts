import { EBML, EBMLFloat32, EBMLFloat64, measureEBMLVarInt, measureUnsignedInt } from "./ebml";

/**
 * A WriteTarget defines a generic target to which data (bytes) can be written in a simple manner. It provides utility
 * methods for writing EBML-based data (the format Matroska or its subset, WebM, uses).
 */
export abstract class WriteTarget {
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
	/** Sets the current position for future writes to a new one. */
	abstract seek(newPos: number): void;

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
				let sizeSize = data.size ?? 4;

				this.seek(this.pos + sizeSize);

				let startPos = this.pos;
				this.dataOffsets.set(data, startPos);
				this.writeEBML(data.data);

				let size = this.pos - startPos;
				let endPos = this.pos;
				this.seek(sizePos);
				this.writeEBMLVarInt(size, sizeSize);
				this.seek(endPos);
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

/** A simple WriteTarget where all data is written into a dynamically-growing buffer in memory. */
export class ArrayBufferWriteTarget extends WriteTarget {
	#buffer = new ArrayBuffer(2**16);
	#bytes = new Uint8Array(this.#buffer);

	constructor() {
		super();
	}

	ensureSize(size: number) {
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
		this.ensureSize(this.pos + data.byteLength);

		this.#bytes.set(data, this.pos);
		this.pos += data.byteLength;
	}

	seek(newPos: number) {
		this.pos = newPos;
	}

	finalize() {
		this.ensureSize(this.pos);
		return this.#buffer.slice(0, this.pos);
	}
}

const FILE_CHUNK_SIZE = 2**24;
const MAX_CHUNKS_AT_ONCE = 2;

interface FileChunk {
	start: number,
	written: FileChunkSection[],
	data: Uint8Array,
	shouldFlush: boolean
}

interface FileChunkSection {
	start: number,
	end: number
}

/**
 * A WriteTarget which writes directly to a file on disk, using the FileSystemWritableFileStream provided by the
 * amazing File System Access API. It minimizes actual writes to disk by caching chunks of data in RAM and then flushing
 * only large chunks of data to disk periodically.
 */
export class FileSystemWritableFileStreamWriteTarget extends WriteTarget {
	#stream: FileSystemWritableFileStream;
	/**
	 * The file is divided up into fixed-size chunks, whose contents are first filled in RAM and then flushed to disk.
	 * A chunk is flushed to disk if all of its contents have been written.
	 */
	#chunks: FileChunk[] = [];

	constructor(stream: FileSystemWritableFileStream) {
		super();

		this.#stream = stream;
	}

	write(data: Uint8Array) {
		this.writeDataIntoChunks(data, this.pos);
		this.flushChunks();

		this.pos += data.byteLength;
	}

	writeDataIntoChunks(data: Uint8Array, position: number) {
		// First, find the chunk to write the data into, or create one if none exists
		let chunkIndex = this.#chunks.findIndex(x => x.start <= position && position < x.start + FILE_CHUNK_SIZE);
		if (chunkIndex === -1) chunkIndex = this.createChunk(position);
		let chunk = this.#chunks[chunkIndex];

		// Figure out how much to write to the chunk, and then write to the chunk
		let relativePosition = position - chunk.start;
		let toWrite = data.subarray(0, Math.min(FILE_CHUNK_SIZE - relativePosition, data.byteLength));
		chunk.data.set(toWrite, relativePosition);

		// Create a section describing the region of data that was just written to
		let section: FileChunkSection = {
			start: relativePosition,
			end: relativePosition + toWrite.byteLength
		};
		insertSectionIntoFileChunk(chunk, section);

		// Queue chunk for flushing to disk if it has been fully written to
		if (chunk.written[0].start === 0 && chunk.written[0].end === FILE_CHUNK_SIZE) {
			chunk.shouldFlush = true;
		}

		// Make sure we don't hold too many chunks in memory at once to keep memory usage down
		if (this.#chunks.length > MAX_CHUNKS_AT_ONCE) {
			// Flush all but the last chunk
			for (let i = 0; i < this.#chunks.length-1; i++) {
				this.#chunks[i].shouldFlush = true;
			}
			this.flushChunks();
		}

		// If the data didn't fit in one chunk, recurse with the remaining datas
		if (toWrite.byteLength < data.byteLength) {
			this.writeDataIntoChunks(data.subarray(toWrite.byteLength), position + toWrite.byteLength);
		}
	}

	createChunk(includesPosition: number) {
		let start = Math.floor(includesPosition / FILE_CHUNK_SIZE) * FILE_CHUNK_SIZE;
		let chunk: FileChunk = {
			start,
			data: new Uint8Array(FILE_CHUNK_SIZE),
			written: [],
			shouldFlush: false
		};
		this.#chunks.push(chunk);
		this.#chunks.sort((a, b) => a.start - b.start);

		return this.#chunks.indexOf(chunk);
	}

	flushChunks(force = false) {
		for (let i = 0; i < this.#chunks.length; i++) {
			let chunk = this.#chunks[i];
			if (!chunk.shouldFlush && !force) continue;

			for (let section of chunk.written) {
				this.#stream.write({
					type: 'write',
					data: chunk.data.subarray(section.start, section.end),
					position: chunk.start + section.start
				});
			}
			this.#chunks.splice(i--, 1);
		}
	}

	seek(newPos: number) {
		this.pos = newPos;
	}

	finalize() {
		this.flushChunks(true);
	}
}

const insertSectionIntoFileChunk = (chunk: FileChunk, section: FileChunkSection) => {
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
};

/**
 * This WriteTarget will fire a callback every time it is flushed, sending out all of the new data written since the
 * last flush. This is useful for streaming applications.
 */
export class StreamingWriteTarget extends WriteTarget {
	#sections: {
		data: Uint8Array,
		start: number
	}[] = [];
	#onFlush: (data: Uint8Array, offset: number, done: boolean) => void;

	constructor(onFlush: (data: Uint8Array, offset: number, done: boolean) => void) {
		super();

		this.#onFlush = onFlush;
	}

	write(data: Uint8Array) {
		this.#sections.push({
			data: data.slice(),
			start: this.pos
		});
		this.pos += data.byteLength;
	}

	seek(newPos: number) {
		this.pos = newPos;
	}

	flush(done: boolean) {
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

			let isLastFlush = done && chunk === chunks[chunks.length - 1];
			this.#onFlush(chunk.data, chunk.start, isLastFlush);
		}

		this.#sections.length = 0;
	}
}