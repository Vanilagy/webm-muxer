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
				this.writeEBMLVarInt(data.data.byteLength);
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
	buffer = new ArrayBuffer(2**24);
	bytes = new Uint8Array(this.buffer);

	constructor() {
		super();
	}

	write(data: Uint8Array) {
		this.bytes.set(data, this.pos);
		this.pos += data.byteLength;
	}

	seek(newPos: number) {
		this.pos = newPos;
	}

	finalize() {
		return this.bytes.slice(0, this.pos);
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

const saveFile = (blob: Blob, filename = 'unnamed.webm') => {
	const a = document.createElement('a');
	document.body.appendChild(a);
	const url = window.URL.createObjectURL(blob);
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => {
		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);
	}, 0);
};

interface WebMWriterOptions {
	video?: {
		codec: string,
		width: number,
		height: number
	},
	audio?: {
		codec: string,
		numberOfChannels: number,
		sampleRate: number
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
	audioCodecPrivate: EBMLElement;
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
		this.target = new ArrayBufferWriteTarget();
		this.options = options;

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
				{ id: 0xe0, data: [
					{ id: 0xb0, data: this.options.video.width },
					{ id: 0xba, data: this.options.video.height }
				] }
			] });
		}
		if (this.options.audio) {
			this.audioCodecPrivate = { id: 0x63a2, data: new Uint8Array(19) };

			tracksElement.data.push({ id: 0xae, data: [
				{ id: 0xd7, data: AUDIO_TRACK_NUMBER },
				{ id: 0x73c5, data: AUDIO_TRACK_NUMBER },
				{ id: 0x83, data: 2 },
				{ id: 0x86, data: this.options.audio.codec },
				this.audioCodecPrivate,
				{ id: 0xe1, data: [
					{ id: 0xb5, data: new EBMLFloat32(this.options.audio.sampleRate) },
					{ id: 0x9f, data: this.options.audio.numberOfChannels}
				] }
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
			this.audioCodecPrivate.data = new Uint8Array(meta.decoderConfig.description as any);
			let endPos = this.target.pos;
			this.target.seek(this.target.offsets.get(this.audioCodecPrivate));
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
	}
}

(async () => {
	let sampleRate = 48000;

	let writer = new WebMWriter({
		video: {
			codec: 'V_VP9',
			width: 1280,
			height: 720
		},
		audio: {
			codec: 'A_OPUS',
			numberOfChannels: 1,
			sampleRate
		}
	});
	
	let canvas = document.createElement('canvas');
	canvas.setAttribute('width', '1280');
	canvas.setAttribute('height', '720');
	let ctx = canvas.getContext('2d');
	
	let videoEncoder = new VideoEncoder({
		output: chunk => writer.addVideoChunk(chunk),
		error: e => console.error(e)
	});
	videoEncoder.configure({
		codec: 'vp09.00.10.08',
		width: 1280, 
		height: 720,
		bitrate: 1e6
	});

	let audioEncoder = new AudioEncoder({
		output: (chunk, meta) => writer.addAudioChunk(chunk, meta),
		error: e => console.error(e)
	});
	audioEncoder.configure({
		codec: 'opus',
		numberOfChannels: 1,
		sampleRate,
		bitrate: 32000,
	});

	let audioContext = new AudioContext();
	let audioBuffer = await audioContext.decodeAudioData(await (await fetch('./CantinaBand60.wav')).arrayBuffer());
	let length = 5;
	let data = new Float32Array(length * sampleRate);
	data.set(audioBuffer.getChannelData(0).subarray(0, data.length), 0);

	let audioData = new AudioData({
		format: 'f32',
		sampleRate,
		numberOfFrames: length * sampleRate,
		numberOfChannels: 1,
		timestamp: 0,
		data: data
	});
	audioEncoder.encode(audioData);
	audioData.close();
	
	for (let i = 0; i < length * 5; i++) {
		ctx.fillStyle = ['red', 'lime', 'blue', 'yellow'][Math.floor(Math.random() * 4)];
		ctx.fillRect(Math.random() * 1280, Math.random() * 720, Math.random() * 1280, Math.random() * 720);

		let videoFrame = new VideoFrame(canvas, { timestamp: i * 1000000/5 });
		videoEncoder.encode(videoFrame);
		videoFrame.close();
	}

	await Promise.allSettled([videoEncoder.flush(), audioEncoder.flush()]);

	writer.finalize();
	
	let buffer = (writer.target as ArrayBufferWriteTarget).finalize();
	
	console.log(buffer);
	saveFile(new Blob([buffer]));
})();