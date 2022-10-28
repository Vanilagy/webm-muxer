import { EBML, EBMLFloat32, EBMLFloat64 } from "./ebml";

export abstract class WriteTarget {
	pos = 0;
	helper = new Uint8Array(8);
	helperView = new DataView(this.helper.buffer);
	offsets = new WeakMap<EBML, number>();
	
	abstract write(data: Uint8Array): void;
	abstract seek(newPos: number): void;

	writeFloat32(value: number) {
		this.helperView.setFloat32(0, value, false);
		this.write(this.helper.subarray(0, 4));
	}

	writeFloat64(value: number) {
		this.helperView.setFloat64(0, value, false);
		this.write(this.helper);
	}

	writeUnsignedInt(value: number, width: number = measureUnsignedInt(value)) {
		let pos = 0;

		// Each case falls through:
		switch (width) {
			case 5:
				this.helperView.setUint8(pos++, Math.floor(value / 2**32)); // Need to use division to access >32 bits of floating point var
			case 4:
				this.helperView.setUint8(pos++, value >> 24);
			case 3:
				this.helperView.setUint8(pos++, value >> 16);
			case 2:
				this.helperView.setUint8(pos++, value >> 8);
			case 1:
				this.helperView.setUint8(pos++, value);
				break;
			default:
				throw new Error('Bad UINT size ' + width);
		}

		this.write(this.helper.subarray(0, pos));
	};

	writeEBMLVarInt(value: number, width: number = measureEBMLVarInt(value)) {
		let pos = 0;

		switch (width) {
			case 1:
				this.helperView.setUint8(pos++, (1 << 7) | value);
				break;
			case 2:
				this.helperView.setUint8(pos++, (1 << 6) | (value >> 8));
				this.helperView.setUint8(pos++, value);
				break;
			case 3:
				this.helperView.setUint8(pos++, (1 << 5) | (value >> 16));
				this.helperView.setUint8(pos++, value >> 8);
				this.helperView.setUint8(pos++, value);
				break;
			case 4:
				this.helperView.setUint8(pos++, (1 << 4) | (value >> 24));
				this.helperView.setUint8(pos++, value >> 16);
				this.helperView.setUint8(pos++, value >> 8);
				this.helperView.setUint8(pos++, value);
				break;
			case 5:
				/*
				* JavaScript converts its doubles to 32-bit integers for bitwise
				* operations, so we need to do a division by 2^32 instead of a
				* right-shift of 32 to retain those top 3 bits
				*/
				this.helperView.setUint8(pos++, (1 << 3) | ((value / 4294967296) & 0x7));
				this.helperView.setUint8(pos++, value >> 24);
				this.helperView.setUint8(pos++, value >> 16);
				this.helperView.setUint8(pos++, value >> 8);
				this.helperView.setUint8(pos++, value);
				break;
			default:
				throw new Error('Bad EBML VINT size ' + width);
		}

		this.write(this.helper.subarray(0, pos));
	};

	writeString(str: string) {
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

			this.writeUnsignedInt(data.id); // ID field

			if (typeof data.data === 'number') {
				let size = data.size ?? measureUnsignedInt(data.data);
				this.writeEBMLVarInt(size);
				this.writeUnsignedInt(data.data, size);
			} else if (Array.isArray(data.data)) {
				let sizePos = this.pos;

				this.seek(this.pos + 4);

				let startPos = this.pos;
				this.writeEBML(data.data);

				let size = this.pos - startPos;
				let endPos = this.pos;
				this.seek(sizePos);
				this.writeEBMLVarInt(size, 4);
				this.seek(endPos);
			} else if (typeof data.data === 'string') {
				this.writeEBMLVarInt(data.data.length);
				this.writeString(data.data);
			} else if (data.data instanceof Uint8Array) {
				this.writeEBMLVarInt(data.data.byteLength, data.size);
				this.write(data.data);
			} else if (data.data instanceof EBMLFloat32) {
				this.writeEBMLVarInt(4);
				this.writeFloat32(data.data.value);
			} else if (data.data instanceof EBMLFloat64) {
				this.writeEBMLVarInt(8);
				this.writeFloat64(data.data.value);
			}
		}
	}
}

const measureUnsignedInt = (value: number) => {
	// Force to 32-bit unsigned integer
	if (value < (1 << 8)) {
		return 1;
	} else if (value < (1 << 16)) {
		return 2;
	} else if (value < (1 << 24)) {
		return 3;
	} else if (value < 2**32) {
		return 4;
	} else {
		return 5;
	}
};

const measureEBMLVarInt = (value: number) => {
	if (value < (1 << 7) - 1) {
		/* Top bit is set, leaving 7 bits to hold the integer, but we can't store
		* 127 because "all bits set to one" is a reserved value. Same thing for the
		* other cases below:
		*/
		return 1;
	} else if (value < (1 << 14) - 1) {
		return 2;
	} else if (value < (1 << 21) - 1) {
		return 3;
	} else if (value < (1 << 28) - 1) {
		return 4;
	} else if (value < 2**35-1) {  // (can address 32GB)
		return 5;
	} else {
		throw new Error('EBML VINT size not supported ' + value);
	}
};

export class ArrayBufferWriteTarget extends WriteTarget {
	buffer = new ArrayBuffer(2**16);
	bytes = new Uint8Array(this.buffer);

	constructor() {
		super();
	}

	ensureSize(size: number) {
		while (this.buffer.byteLength < size) {
			let newBuffer = new ArrayBuffer(2 * this.buffer.byteLength);
			let newBytes = new Uint8Array(newBuffer);
			newBytes.set(this.bytes, 0);

			this.buffer = newBuffer;
			this.bytes = newBytes;
		}
	}

	write(data: Uint8Array) {
		this.ensureSize(this.pos + data.byteLength);

		this.bytes.set(data, this.pos);
		this.pos += data.byteLength;
	}

	seek(newPos: number) {
		this.pos = newPos;
	}

	finalize() {
		this.ensureSize(this.pos);
		return this.buffer.slice(0, this.pos);
	}
}

const FILE_CHUNK_SIZE = 2**24;

interface FileChunk {
	start: number,
	written: FileChunkSection[],
	data: Uint8Array
}

interface FileChunkSection {
	start: number,
	end: number
}

export class FileSystemWritableFileStreamWriteTarget extends WriteTarget {
	stream: FileSystemWritableFileStream;
	chunks: FileChunk[] = [];
	toFlush: FileChunk[] = [];

	constructor(stream: FileSystemWritableFileStream) {
		super();

		this.stream = stream;
	}

	write(data: Uint8Array) {
		this.writeDataIntoChunks(data, this.pos);
		this.flushChunks();

		this.pos += data.byteLength;
	}

	writeDataIntoChunks(data: Uint8Array, position: number) {
		let chunkIndex = this.chunks.findIndex(x => x.start <= position && position < x.start + FILE_CHUNK_SIZE);
		if (chunkIndex === -1) chunkIndex = this.createChunk(position);
		let chunk = this.chunks[chunkIndex];

		let relativePosition = position - chunk.start;
		let toWrite = data.subarray(0, Math.min(FILE_CHUNK_SIZE - relativePosition, data.byteLength));
		chunk.data.set(toWrite, relativePosition);

		let section: FileChunkSection = {
			start: relativePosition,
			end: relativePosition + toWrite.byteLength
		};
		insertSectionIntoFileChunk(chunk, section);

		if (chunk.written[0].start === 0 && chunk.written[0].end === FILE_CHUNK_SIZE) {
			this.toFlush.push(chunk);
			this.chunks.splice(chunkIndex, 1);
		}

		if (toWrite.byteLength < data.byteLength) {
			this.writeDataIntoChunks(data.subarray(toWrite.byteLength), position + toWrite.byteLength);
		}
	}

	createChunk(includesPosition: number) {
		let start = Math.floor(includesPosition / FILE_CHUNK_SIZE) * FILE_CHUNK_SIZE;
		let chunk: FileChunk = {
			start,
			data: new Uint8Array(FILE_CHUNK_SIZE),
			written: []
		};
		this.chunks.push(chunk);

		return this.chunks.length - 1;
	}

	flushChunks() {
		if (this.toFlush.length > 0) {
			for (let chunk of this.toFlush) {
				for (let section of chunk.written) {
					this.stream.write({
						type: 'write',
						data: chunk.data.subarray(section.start, section.end),
						position: chunk.start + section.start
					});
				}
			}
			this.toFlush.length = 0;
		}
	}

	seek(newPos: number) {
		this.pos = newPos;
	}

	finalize() {
		this.toFlush.push(...this.chunks);
		this.chunks.length = 0;

		this.flushChunks();
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

	chunk.written.splice(index + 1, 0, section);
	if (index === -1 || chunk.written[index].end < section.start) index++;

	while (index < chunk.written.length - 1 && chunk.written[index].end >= chunk.written[index + 1].start) {
		chunk.written[index].end = Math.max(chunk.written[index].end, chunk.written[index + 1].end);
		chunk.written.splice(index + 1, 1);
	}
};