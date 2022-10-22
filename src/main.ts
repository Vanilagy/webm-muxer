const VIDEO_TRACK_NUMBER = 1;
const AUDIO_TRACK_NUMBER = 2;
const MAX_CHUNK_LENGTH_MS = 32_000;

interface EBMLElement {
	id: number,
	size?: number,
	data: number | string | Uint8Array | EBMLFloat32 | EBMLFloat64 | EBML[]
}

type EBML = EBMLElement | Uint8Array | EBML[];

class EBMLFloat32 {
	value: number;

	constructor(value: number) {
		this.value = value;
	}
}

class EBMLFloat64 {
	value: number;

	constructor(value: number) {
		this.value = value;
	}
}

abstract class WriteTarget {
	pos = 0;
	helper = new Uint8Array(8);
	helperView = new DataView(this.helper.buffer);
	offsets = new WeakMap<EBML, number>();
	
	abstract write(data: Uint8Array): void;
	abstract seek(newPos: number): void;

	writeU8(value: number) {
		this.helperView.setUint8(0, value);
		this.write(this.helper.subarray(0, 1));
	}

	writeFloat32(value: number) {
		this.helperView.setFloat32(0, value, false);
		this.write(this.helper.subarray(0, 4));
	}

	writeFloat64(value: number) {
		this.helperView.setFloat64(0, value, false);
		this.write(this.helper);
	}

	writeUnsignedInt(value: number, width: number = measureUnsignedInt(value)) {
		// Each case falls through:
		switch (width) {
			case 5:
			this.writeU8(
				Math.floor(value / 2**32));  // Need to use division to access >32 bits of floating point var
			case 4:
				this.writeU8(value >> 24);
			case 3:
				this.writeU8(value >> 16);
			case 2:
				this.writeU8(value >> 8);
			case 1:
				this.writeU8(value);
				break;
			default:
				throw new Error('Bad UINT size ' + width);
		}
	};

	writeEBMLVarInt(value: number, width: number = measureEBMLVarInt(value)) {
		switch (width) {
			case 1:
				this.writeU8((1 << 7) | value);
				break;
			case 2:
				this.writeU8((1 << 6) | (value >> 8));
				this.writeU8(value);
				break;
			case 3:
				this.writeU8((1 << 5) | (value >> 16));
				this.writeU8(value >> 8);
				this.writeU8(value);
				break;
			case 4:
				this.writeU8((1 << 4) | (value >> 24));
				this.writeU8(value >> 16);
				this.writeU8(value >> 8);
				this.writeU8(value);
				break;
			case 5:
				/*
				* JavaScript converts its doubles to 32-bit integers for bitwise
				* operations, so we need to do a division by 2^32 instead of a
				* right-shift of 32 to retain those top 3 bits
				*/
				this.writeU8((1 << 3) | ((value / 4294967296) & 0x7));
				this.writeU8(value >> 24);
				this.writeU8(value >> 16);
				this.writeU8(value >> 8);
				this.writeU8(value);
				break;
			default:
				throw new Error('Bad EBML VINT size ' + width);
		}
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

class ArrayBufferWriteTarget extends WriteTarget {
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

class FileSystemWritableFileStreamWriteTarget extends WriteTarget {
	stream: FileSystemWritableFileStream;

	constructor(stream: FileSystemWritableFileStream) {
		super();

		this.stream = stream;
	}

	write(data: Uint8Array) {
		data = data.slice(); // Need to clone the underlying buffer (and make sure it doesn't change anymore) for the file system API to work correctly
		this.stream.write({ type: 'write', data: data.slice(), position: this.pos });
		this.pos += data.byteLength;
	}

	seek(newPos: number) {
		this.pos = newPos;
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

interface WebMWriterOptions {
	target: 'buffer' | FileSystemWritableFileStream,
	video?: {
		codec: string,
		width: number,
		height: number
		frameRate?: number
	},
	audio?: {
		codec: string,
		numberOfChannels: number,
		sampleRate: number,
		bitDepth?: number
	}
}

class WebMWriter {
	target: WriteTarget;
	options: WebMWriterOptions;
	segment: EBMLElement;
	segmentInfo: EBMLElement;
	tracksElement: EBMLElement;
	currentCluster: EBMLElement;
	currentClusterTimestamp: number;
	segmentDuration: EBMLElement;
	audioCodecPrivate: EBML;
	cues: EBMLElement;
	seekHead: {
		id: number;
		data: {
			id: number;
			data: ({
				id: number;
				data: Uint8Array;
				size?: undefined;
			} | {
				id: number;
				size: number;
				data: number;
			})[];
		}[];
	};

	duration = 0;
	videoChunkQueue: EncodedVideoChunk[] = [];
	audioChunkQueue: EncodedAudioChunk[] = [];
	lastVideoTimestamp = 0;
	lastAudioTimestamp = 0;

	constructor(options: WebMWriterOptions) {
		this.options = options;

		if (options.target === 'buffer') {
			this.target = new ArrayBufferWriteTarget();
		} else {
			this.target = new FileSystemWritableFileStreamWriteTarget(options.target);
		}

		this.writeHeader();
	}

	writeHeader() {
		let ebmlHeader: EBML = { id: 0x1a45dfa3, data: [
			{ id: 0x4286, data: 1 },
			{ id: 0x42f7, data: 1 },
			{ id: 0x42f2, data: 4 },
			{ id: 0x42f3, data: 8 },
			{ id: 0x4282, data: 'webm' },
			{ id: 0x4287, data: 2 },
			{ id: 0x4285, data: 2 }
		] };
		this.target.writeEBML(ebmlHeader);

		let seekHead = { id: 0x114D9B74, data: [
			{ id: 0x4DBB, data: [
				{ id: 0x53AB, data: new Uint8Array([ 0x1C, 0x53, 0xBB, 0x6B ]) },
				{ id: 0x53AC, size: 5, data: 0 }
			] },
			{ id: 0x4DBB, data: [
				{ id: 0x53AB, data: new Uint8Array([ 0x15, 0x49, 0xA9, 0x66 ]) },
				{ id: 0x53AC, size: 5, data: 0 }
			] },
			{ id: 0x4DBB, data: [
				{ id: 0x53AB, data: new Uint8Array([ 0x16, 0x54, 0xAE, 0x6B ]) },
				{ id: 0x53AC, size: 5, data: 0 }
			] }
		] };
		this.seekHead = seekHead;

		let segmentDuration: EBML = { id: 0x4489, data: new EBMLFloat64(0) };
		this.segmentDuration = segmentDuration;

		let segmentInfo: EBML = { id: 0x1549a966, data: [
			{ id: 0x2ad7b1, data: 1e6 },
			{ id: 0x4d80, data: "Vani's epic muxer" },
			{ id: 0x5741, data: "Vani's epic muxer" },
			segmentDuration
		] };
		this.segmentInfo = segmentInfo;

		let tracksElement = { id: 0x1654ae6b, data: [] as EBML[] };
		this.tracksElement = tracksElement;

		if (this.options.video) {
			tracksElement.data.push({ id: 0xae, data: [
				{ id: 0xd7, data: VIDEO_TRACK_NUMBER },
				{ id: 0x73c5, data: VIDEO_TRACK_NUMBER },
				{ id: 0x83, data: 1 },
				{ id: 0x86, data: this.options.video.codec },
				(this.options.video.frameRate ? { id: 0x23E383, data: 1e9/this.options.video.frameRate } : null),
				{ id: 0xe0, data: [
					{ id: 0xb0, data: this.options.video.width },
					{ id: 0xba, data: this.options.video.height }
				] }
			].filter(Boolean) });
		}
		if (this.options.audio) {
			this.audioCodecPrivate = { id: 0xec, size: 4, data: new Uint8Array(2**11) }; // Reserve 2 kiB for the CodecPrivate element

			tracksElement.data.push({ id: 0xae, data: [
				{ id: 0xd7, data: AUDIO_TRACK_NUMBER },
				{ id: 0x73c5, data: AUDIO_TRACK_NUMBER },
				{ id: 0x83, data: 2 },
				{ id: 0x86, data: this.options.audio.codec },
				this.audioCodecPrivate,
				{ id: 0xe1, data: [
					{ id: 0xb5, data: new EBMLFloat32(this.options.audio.sampleRate) },
					{ id: 0x9f, data: this.options.audio.numberOfChannels},
					(this.options.audio.bitDepth ? { id: 0x6264, data: this.options.audio.bitDepth } : null)
				].filter(Boolean) }
			] });
		}

		let segment: EBML = { id: 0x18538067, size: 5, data: [
			seekHead,
			segmentInfo,
			tracksElement
		] };
		this.segment = segment;

		this.target.writeEBML(segment);

		this.cues = { id: 0x1C53BB6B, data: [] };
	}

	addVideoChunk(chunk: EncodedVideoChunk) {
		this.lastVideoTimestamp = chunk.timestamp;
		
		console.log(chunk);

		while (this.audioChunkQueue.length > 0 && this.audioChunkQueue[0].timestamp <= chunk.timestamp) {
			let audioChunk = this.audioChunkQueue.shift();
			this.writeSimpleBlock(audioChunk);
		}

		if (!this.options.audio || chunk.timestamp <= this.lastAudioTimestamp) {
			this.writeSimpleBlock(chunk);
			this.lastVideoTimestamp = chunk.timestamp;
		} else {
			this.videoChunkQueue.push(chunk);
		}
	}
	
	addAudioChunk(chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata) {
		this.lastAudioTimestamp = chunk.timestamp;
		
		console.log(chunk);

		while (this.videoChunkQueue.length > 0 && this.videoChunkQueue[0].timestamp <= chunk.timestamp) {
			let videoChunk = this.videoChunkQueue.shift();
			this.writeSimpleBlock(videoChunk);
		}

		if (!this.options.video || chunk.timestamp <= this.lastVideoTimestamp) {
			this.writeSimpleBlock(chunk);
			this.lastAudioTimestamp = chunk.timestamp;
		} else {
			this.audioChunkQueue.push(chunk);
		}

		if (meta?.decoderConfig) {
			let endPos = this.target.pos;
			this.target.seek(this.target.offsets.get(this.audioCodecPrivate));

			this.audioCodecPrivate = [
				{ id: 0x63a2, size: 4, data: new Uint8Array(meta.decoderConfig.description as any) },
				{ id: 0xec, size: 4, data: new Uint8Array(2**11 - 2 - 4 - meta.decoderConfig.description.byteLength) }
			];
			
			this.target.writeEBML(this.audioCodecPrivate);
			this.target.seek(endPos);
		}
	}

	writeSimpleBlock(chunk: EncodedVideoChunk | EncodedAudioChunk) {
		let msTime = Math.floor(chunk.timestamp / 1000);

		if (!this.currentCluster || (chunk instanceof EncodedVideoChunk && chunk.type === 'key' || msTime - this.currentClusterTimestamp >= MAX_CHUNK_LENGTH_MS)) {
			this.createNewCluster(msTime);
		}

		let prelude = new Uint8Array(4);
		let view = new DataView(prelude.buffer);

		view.setUint8(0, 0x80 | ((chunk instanceof EncodedVideoChunk) ? VIDEO_TRACK_NUMBER : AUDIO_TRACK_NUMBER));
		view.setUint16(1, msTime - this.currentClusterTimestamp, false);
		view.setUint8(3, Number(chunk.type === 'key') << 7); // Flags

		let data = new Uint8Array(chunk.byteLength);
		chunk.copyTo(data);

		let simpleBlock = { id: 0xA3, data: [
			prelude,
			data
		] };
		this.target.writeEBML(simpleBlock);

		this.duration = Math.max(this.duration, msTime);
	}

	createNewCluster(timestamp: number) {
		if (this.currentCluster) {
			this.finalizeCurrentCluster();
		}

		this.currentCluster = { id: 0x1f43b675, data: [
			{ id: 0xe7, data: timestamp }
		] };
		this.target.writeEBML(this.currentCluster);

		this.currentClusterTimestamp = timestamp;

		(this.cues.data as EBML[]).push({ id: 0xBB, data: [
			{ id: 0xB3, data: timestamp },
			{ id: 0xB7, data: [
				{ id: 0xF7, data: VIDEO_TRACK_NUMBER },
				{ id: 0xF1, data: this.target.offsets.get(this.currentCluster) - (this.target.offsets.get(this.segment) + 8) }
			] }
		] });
	}

	finalizeCurrentCluster() {
		let clusterSize = this.target.pos - (this.target.offsets.get(this.currentCluster) + 8);
		let endPos = this.target.pos;

		this.target.seek(this.target.offsets.get(this.currentCluster) + 4);
		this.target.writeEBMLVarInt(clusterSize, 4);
		this.target.seek(endPos);
	}

	finalize() {
		while (this.videoChunkQueue.length > 0) this.writeSimpleBlock(this.videoChunkQueue.shift());
		while (this.audioChunkQueue.length > 0) this.writeSimpleBlock(this.audioChunkQueue.shift());

		this.finalizeCurrentCluster();
		this.target.writeEBML(this.cues);

		let endPos = this.target.pos;

		let segmentSize = this.target.pos - (this.target.offsets.get(this.segment) + 8);
		this.target.seek(this.target.offsets.get(this.segment) + 4);
		this.target.writeEBMLVarInt(segmentSize, 4);

		this.segmentDuration.data = new EBMLFloat64(this.duration);
		this.target.seek(this.target.offsets.get(this.segmentDuration));
		this.target.writeEBML(this.segmentDuration);

		this.seekHead.data[0].data[1].data = this.target.offsets.get(this.cues) - (this.target.offsets.get(this.segment) + 8);
		this.seekHead.data[1].data[1].data = this.target.offsets.get(this.segmentInfo) - (this.target.offsets.get(this.segment) + 8);
		this.seekHead.data[2].data[1].data = this.target.offsets.get(this.tracksElement) - (this.target.offsets.get(this.segment) + 8);

		this.target.seek(this.target.offsets.get(this.seekHead));
		this.target.writeEBML(this.seekHead);

		this.target.seek(endPos);

		if (this.target instanceof ArrayBufferWriteTarget) {
			return this.target.finalize();
		}
		return null;
	}
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
	module.exports = WebMWriter;
}
if (typeof globalThis !== 'undefined') {
	(globalThis as any).WebMWriter = WebMWriter;
}