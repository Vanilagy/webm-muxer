import { EBMLElement, EBML, EBMLFloat64, EBMLFloat32, EBMLId } from "./ebml";
import {
	WriteTarget,
	ArrayBufferWriteTarget,
	FileSystemWritableFileStreamWriteTarget,
	StreamingWriteTarget
} from "./write_target";

const VIDEO_TRACK_NUMBER = 1;
const AUDIO_TRACK_NUMBER = 2;
const VIDEO_TRACK_TYPE = 1;
const AUDIO_TRACK_TYPE = 2;
const MAX_CHUNK_LENGTH_MS = 2**15;
const CODEC_PRIVATE_MAX_SIZE = 2**12;
const APP_NAME = 'https://github.com/Vanilagy/webm-muxer';
const SEGMENT_SIZE_BYTES = 6;
const CLUSTER_SIZE_BYTES = 5;
const FIRST_TIMESTAMP_BEHAVIORS = ['strict',  'offset', 'permissive'] as const;

interface WebMMuxerOptions {
	target:
		'buffer'
		| ((data: Uint8Array, offset: number, done: boolean) => void)
		| FileSystemWritableFileStream,
	video?: {
		codec: string,
		width: number,
		height: number
		frameRate?: number,
		alpha?: boolean
	},
	audio?: {
		codec: string,
		numberOfChannels: number,
		sampleRate: number,
		bitDepth?: number
	},
	type?: 'webm' | 'matroska',
	firstTimestampBehavior?: typeof FIRST_TIMESTAMP_BEHAVIORS[number]
}

interface InternalMediaChunk {
	data: Uint8Array,
	timestamp: number,
	type: 'key' | 'delta',
	trackNumber: number
}

class WebMMuxer {
	#target: WriteTarget;
	#options: WebMMuxerOptions;

	#segment: EBMLElement;
	#segmentInfo: EBMLElement;
	#seekHead: {
		id: number,
		data: {
			id: number,
			data: ({
				id: number,
				data: Uint8Array,
				size?: undefined
			} | {
				id: number,
				size: number,
				data: number
			})[]
		}[]
	};
	#tracksElement: EBMLElement;
	#segmentDuration: EBMLElement;
	#colourElement: EBMLElement;
	#videoCodecPrivate: EBML;
	#audioCodecPrivate: EBML;
	#cues: EBMLElement;

	#currentCluster: EBMLElement;
	#currentClusterTimestamp: number;

	#duration = 0;
	#videoChunkQueue: InternalMediaChunk[] = [];
	#audioChunkQueue: InternalMediaChunk[] = [];
	#firstVideoTimestamp: number;
	#firstAudioTimestamp: number;
	#lastVideoTimestamp = -1;
	#lastAudioTimestamp = -1;
	#colorSpace: VideoColorSpaceInit;
	#finalized = false;

	constructor(options: WebMMuxerOptions) {
		this.#validateOptions(options);

		this.#options = {
			type: 'webm',
			firstTimestampBehavior: 'strict',
			...options
		};

		if (options.target === 'buffer') {
			this.#target = new ArrayBufferWriteTarget();
		} else if (options.target instanceof FileSystemWritableFileStream) {
			this.#target = new FileSystemWritableFileStreamWriteTarget(options.target);
		} else if (typeof options.target === 'function') {
			this.#target = new StreamingWriteTarget(options.target);
		} else {
			throw new Error(`Invalid target: ${options.target}`);
		}

		this.#createFileHeader();
	}

	#validateOptions(options: WebMMuxerOptions) {
		if (options.type && options.type !== 'webm' && options.type !== 'matroska') {
			throw new Error(`Invalid type: ${options.type}`);
		}

		if (options.firstTimestampBehavior && !FIRST_TIMESTAMP_BEHAVIORS.includes(options.firstTimestampBehavior)) {
			throw new Error(`Invalid first timestamp behavior: ${options.firstTimestampBehavior}`);
		}
	}

	#createFileHeader() {
		this.#writeEBMLHeader();

		this.#createSeekHead();
		this.#createSegmentInfo();
		this.#createTracks();
		this.#createSegment();
		this.#createCues();

		this.#maybeFlushStreamingTarget();
	}

	#writeEBMLHeader() {
		let ebmlHeader: EBML = { id: EBMLId.EBML, data: [
			{ id: EBMLId.EBMLVersion, data: 1 },
			{ id: EBMLId.EBMLReadVersion, data: 1 },
			{ id: EBMLId.EBMLMaxIDLength, data: 4 },
			{ id: EBMLId.EBMLMaxSizeLength, data: 8 },
			{ id: EBMLId.DocType, data: this.#options.type ?? 'webm' },
			{ id: EBMLId.DocTypeVersion, data: 2 },
			{ id: EBMLId.DocTypeReadVersion, data: 2 }
		] };
		this.#target.writeEBML(ebmlHeader);
	}

	/**
	 * Creates a SeekHead element which is positioned near the start of the file and allows the media player to seek to
	 * relevant sections more easily. Since we don't know the positions of those sections yet, we'll set them later.
	 */
	#createSeekHead() {
		const kaxCues = new Uint8Array([ 0x1c, 0x53, 0xbb, 0x6b ]);
		const kaxInfo = new Uint8Array([ 0x15, 0x49, 0xa9, 0x66 ]);
		const kaxTracks = new Uint8Array([ 0x16, 0x54, 0xae, 0x6b ]);

		let seekHead = { id: EBMLId.SeekHead, data: [
			{ id: EBMLId.Seek, data: [
				{ id: EBMLId.SeekID, data: kaxCues },
				{ id: EBMLId.SeekPosition, size: 5, data: 0 }
			] },
			{ id: EBMLId.Seek, data: [
				{ id: EBMLId.SeekID, data: kaxInfo },
				{ id: EBMLId.SeekPosition, size: 5, data: 0 }
			] },
			{ id: EBMLId.Seek, data: [
				{ id: EBMLId.SeekID, data: kaxTracks },
				{ id: EBMLId.SeekPosition, size: 5, data: 0 }
			] }
		] };
		this.#seekHead = seekHead;
	}

	#createSegmentInfo() {
		let segmentDuration: EBML = { id: EBMLId.Duration, data: new EBMLFloat64(0) };
		this.#segmentDuration = segmentDuration;

		let segmentInfo: EBML = { id: EBMLId.Info, data: [
			{ id: EBMLId.TimestampScale, data: 1e6 },
			{ id: EBMLId.MuxingApp, data: APP_NAME },
			{ id: EBMLId.WritingApp, data: APP_NAME },
			segmentDuration
		] };
		this.#segmentInfo = segmentInfo;
	}

	#createTracks() {
		let tracksElement = { id: EBMLId.Tracks, data: [] as EBML[] };
		this.#tracksElement = tracksElement;

		if (this.#options.video) {
			// Reserve 4 kiB for the CodecPrivate element
			this.#videoCodecPrivate = { id: EBMLId.Void, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) };

			let colourElement = { id: EBMLId.Colour, data: [
				// All initially unspecified
				{ id: EBMLId.MatrixCoefficients, data: 2 },
				{ id: EBMLId.TransferCharacteristics, data: 2 },
				{ id: EBMLId.Primaries, data: 2 },
				{ id: EBMLId.Range, data: 0 }
			] };
			this.#colourElement = colourElement;

			tracksElement.data.push({ id: EBMLId.TrackEntry, data: [
				{ id: EBMLId.TrackNumber, data: VIDEO_TRACK_NUMBER },
				{ id: EBMLId.TrackUID, data: VIDEO_TRACK_NUMBER },
				{ id: EBMLId.TrackType, data: VIDEO_TRACK_TYPE },
				{ id: EBMLId.CodecID, data: this.#options.video.codec },
				this.#videoCodecPrivate,
				(this.#options.video.frameRate ?
					{ id: EBMLId.DefaultDuration, data: 1e9/this.#options.video.frameRate } :
					null
				),
				{ id: EBMLId.Video, data: [
					{ id: EBMLId.PixelWidth, data: this.#options.video.width },
					{ id: EBMLId.PixelHeight, data: this.#options.video.height },
					(this.#options.video.alpha ? { id: EBMLId.AlphaMode, data: 1 } : null),
					colourElement
				].filter(Boolean) }
			].filter(Boolean) });
		}
		if (this.#options.audio) {
			this.#audioCodecPrivate = { id: EBMLId.Void, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) };

			tracksElement.data.push({ id: EBMLId.TrackEntry, data: [
				{ id: EBMLId.TrackNumber, data: AUDIO_TRACK_NUMBER },
				{ id: EBMLId.TrackUID, data: AUDIO_TRACK_NUMBER },
				{ id: EBMLId.TrackType, data: AUDIO_TRACK_TYPE },
				{ id: EBMLId.CodecID, data: this.#options.audio.codec },
				this.#audioCodecPrivate,
				{ id: EBMLId.Audio, data: [
					{ id: EBMLId.SamplingFrequency, data: new EBMLFloat32(this.#options.audio.sampleRate) },
					{ id: EBMLId.Channels, data: this.#options.audio.numberOfChannels},
					(this.#options.audio.bitDepth ?
						{ id: EBMLId.BitDepth, data: this.#options.audio.bitDepth } :
						null
					)
				].filter(Boolean) }
			] });
		}
	}

	#createSegment() {
		let segment: EBML = { id: EBMLId.Segment, size: SEGMENT_SIZE_BYTES, data: [
			this.#seekHead as EBML,
			this.#segmentInfo,
			this.#tracksElement
		] };
		this.#segment = segment;

		this.#target.writeEBML(segment);
	}

	#createCues() {
		this.#cues = { id: EBMLId.Cues, data: [] };
	}

	#maybeFlushStreamingTarget() {
		if (this.#target instanceof StreamingWriteTarget) {
			this.#target.flush(false);
		}
	}

	get #segmentDataOffset() {
		return this.#target.dataOffsets.get(this.#segment);
	}

	addVideoChunk(chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata, timestamp?: number) {
		let data = new Uint8Array(chunk.byteLength);
		chunk.copyTo(data);

		this.addVideoChunkRaw(data, chunk.type, timestamp ?? chunk.timestamp, meta);
	}

	addVideoChunkRaw(data: Uint8Array, type: 'key' | 'delta', timestamp: number, meta?: EncodedVideoChunkMetadata) {
		this.#ensureNotFinalized();
		if (!this.#options.video) throw new Error("No video track declared.");

		if (this.#firstVideoTimestamp === undefined) this.#firstVideoTimestamp = timestamp;
		if (meta) this.#writeVideoDecoderConfig(meta);

		let internalChunk = this.#createInternalChunk(data, type, timestamp, VIDEO_TRACK_NUMBER);
		if (this.#options.video.codec === 'V_VP9') this.#fixVP9ColorSpace(internalChunk);

		/**
		 * Ok, so the algorithm used to insert video and audio blocks (if both are present) is one where we want to
		 * insert the blocks sorted, i.e. always monotonically increasing in timestamp. This means that we can write
		 * an audio chunk of timestamp t_a only when we have a video chunk of timestamp t_v >= t_a, and vice versa.
		 * This means that we need to often queue up a lot of video/audio chunks and wait for their counterpart to
		 * arrive before they are written to the file. When the video writing is finished, it is important that any
		 * chunks remaining in the queues also be flushed to the file.
		 */

		this.#lastVideoTimestamp = internalChunk.timestamp;

		// Write all audio chunks with a timestamp smaller than the incoming video chunk
		while (this.#audioChunkQueue.length > 0 && this.#audioChunkQueue[0].timestamp <= internalChunk.timestamp) {
			let audioChunk = this.#audioChunkQueue.shift();
			this.#writeSimpleBlock(audioChunk);
		}

		// Depending on the last audio chunk, either write the video chunk to the file or enqueue it
		if (!this.#options.audio || internalChunk.timestamp <= this.#lastAudioTimestamp) {
			this.#writeSimpleBlock(internalChunk);
		} else {
			this.#videoChunkQueue.push(internalChunk);
		}

		this.#maybeFlushStreamingTarget();
	}

	#writeVideoDecoderConfig(meta: EncodedVideoChunkMetadata) {
		// Write possible video decoder metadata to the file
		if (meta.decoderConfig) {
			if (meta.decoderConfig.colorSpace) {
				let colorSpace = meta.decoderConfig.colorSpace;
				this.#colorSpace = colorSpace;

				this.#colourElement.data = [
					{ id: EBMLId.MatrixCoefficients, data: {
						'rgb': 1,
						'bt709': 1,
						'bt470bg': 5,
						'smpte170m': 6
					}[colorSpace.matrix] },
					{ id: EBMLId.TransferCharacteristics, data: {
						'bt709': 1,
						'smpte170m': 6,
						'iec61966-2-1': 13
					}[colorSpace.transfer] },
					{ id: EBMLId.Primaries, data: {
						'bt709': 1,
						'bt470bg': 5,
						'smpte170m': 6
					}[colorSpace.primaries] },
					{ id: EBMLId.Range, data: [1, 2][Number(colorSpace.fullRange)] }
				];

				let endPos = this.#target.pos;
				this.#target.seek(this.#target.offsets.get(this.#colourElement));
				this.#target.writeEBML(this.#colourElement);
				this.#target.seek(endPos);
			}

			if (meta.decoderConfig.description) {
				this.#writeCodecPrivate(this.#videoCodecPrivate, meta.decoderConfig.description);
			}
		}
	}

	/** Due to [a bug in Chromium](https://bugs.chromium.org/p/chromium/issues/detail?id=1377842), VP9 streams often
	 * lack color space information. This method patches in that information. */
	// http://downloads.webmproject.org/docs/vp9/vp9-bitstream_superframe-and-uncompressed-header_v1.0.pdf
	#fixVP9ColorSpace(chunk: InternalMediaChunk) {
		if (chunk.type !== 'key') return;
		if (!this.#colorSpace) return;

		let i = 0;
		// Check if it's a "superframe"
		if (readBits(chunk.data, 0, 2) !== 0b10) return; i += 2;

		let profile = (readBits(chunk.data, i+1, i+2) << 1) + readBits(chunk.data, i+0, i+1); i += 2;
		if (profile === 3) i++;

		let showExistingFrame = readBits(chunk.data, i+0, i+1); i++;
		if (showExistingFrame) return;

		let frameType = readBits(chunk.data, i+0, i+1); i++;
		if (frameType !== 0) return; // Just to be sure

		i += 2;

		let syncCode = readBits(chunk.data, i+0, i+24); i += 24;
		if (syncCode !== 0x498342) return;

		if (profile >= 2) i++;

		let colorSpaceID = {
			'rgb': 7,
			'bt709': 2,
			'bt470bg': 1,
			'smpte170m': 3
		}[this.#colorSpace.matrix];
		writeBits(chunk.data, i+0, i+3, colorSpaceID);
	}

	addAudioChunk(chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata, timestamp?: number) {
		let data = new Uint8Array(chunk.byteLength);
		chunk.copyTo(data);

		this.addAudioChunkRaw(data, chunk.type, timestamp ?? chunk.timestamp, meta);
	}

	addAudioChunkRaw(data: Uint8Array, type: 'key' | 'delta', timestamp: number, meta?: EncodedAudioChunkMetadata) {
		this.#ensureNotFinalized();
		if (!this.#options.audio) throw new Error("No audio track declared.");

		if (this.#firstAudioTimestamp === undefined) this.#firstAudioTimestamp = timestamp;

		let internalChunk = this.#createInternalChunk(data, type, timestamp, AUDIO_TRACK_NUMBER);

		// Algorithm explained in `addVideoChunk`
		this.#lastAudioTimestamp = internalChunk.timestamp;

		while (this.#videoChunkQueue.length > 0 && this.#videoChunkQueue[0].timestamp <= internalChunk.timestamp) {
			let videoChunk = this.#videoChunkQueue.shift();
			this.#writeSimpleBlock(videoChunk);
		}

		if (!this.#options.video || internalChunk.timestamp <= this.#lastVideoTimestamp) {
			this.#writeSimpleBlock(internalChunk);
		} else {
			this.#audioChunkQueue.push(internalChunk);
		}

		// Write possible audio decoder metadata to the file
		if (meta?.decoderConfig) {
			this.#writeCodecPrivate(this.#audioCodecPrivate, meta.decoderConfig.description);
		}

		this.#maybeFlushStreamingTarget();
	}

	/** Converts a read-only external chunk into an internal one for easier use. */
	#createInternalChunk(data: Uint8Array, type: 'key' | 'delta', timestamp: number, trackNumber: number) {
		let adjustedTimestamp = this.#validateTimestamp(timestamp, trackNumber);

		let internalChunk: InternalMediaChunk = {
			data,
			type,
			timestamp: adjustedTimestamp,
			trackNumber
		};

		return internalChunk;
	}

	#validateTimestamp(timestamp: number, trackNumber: number) {
		let firstTimestamp = trackNumber === VIDEO_TRACK_NUMBER ? this.#firstVideoTimestamp : this.#firstAudioTimestamp;
		let lastTimestamp = trackNumber === VIDEO_TRACK_NUMBER ? this.#lastVideoTimestamp : this.#lastAudioTimestamp;

		// Check first timestamp behavior
		if (this.#options.firstTimestampBehavior === 'strict' && lastTimestamp === -1 && timestamp !== 0) {
			throw new Error(
				`The first chunk for your media track must have a timestamp of 0 (received ${timestamp}). Non-zero ` +
				`first timestamps are often caused by directly piping frames or audio data from a MediaStreamTrack ` +
				`into the encoder. Their timestamps are typically relative to the age of the document, which is ` +
				`probably what you want.\n\nIf you want to offset all timestamps of a track such that the first one ` +
				`is zero, set firstTimestampBehavior: 'offset' in the options.\nIf you want to allow non-zero first ` +
				`timestamps, set firstTimestampBehavior: 'permissive'.\n`
			);
		} else if (this.#options.firstTimestampBehavior === 'offset') {
			timestamp -= firstTimestamp;
		}

		if (timestamp < lastTimestamp) {
			throw new Error(
				`Timestamps must be monotonically increasing (went from ${lastTimestamp} to ${timestamp}).`
			);
		}

		return timestamp;
	}

	/** Writes an EBML SimpleBlock containing video or audio data to the file. */
	#writeSimpleBlock(chunk: InternalMediaChunk) {
		let msTime = Math.floor(chunk.timestamp / 1000);
		let clusterIsTooLong = chunk.type !== 'key' && msTime - this.#currentClusterTimestamp >= MAX_CHUNK_LENGTH_MS;

		if (clusterIsTooLong) {
			throw new Error(
				`Current Matroska cluster exceeded its maximum allowed length of ${MAX_CHUNK_LENGTH_MS} ` +
				`milliseconds. In order to produce a correct WebM file, you must pass in a video key frame at least ` +
				`every ${MAX_CHUNK_LENGTH_MS} milliseconds.`
			);
		}

		let shouldCreateNewClusterFromKeyFrame =
			(chunk.trackNumber === VIDEO_TRACK_NUMBER || !this.#options.video) &&
			chunk.type === 'key' &&
			msTime - this.#currentClusterTimestamp >= 1000;

		if (
			!this.#currentCluster ||
			shouldCreateNewClusterFromKeyFrame
		) {
			this.#createNewCluster(msTime);
		}

		let prelude = new Uint8Array(4);
		let view = new DataView(prelude.buffer);
		// 0x80 to indicate it's the last byte of a multi-byte number
		view.setUint8(0, 0x80 | chunk.trackNumber);
		view.setUint16(1, msTime - this.#currentClusterTimestamp, false);
		view.setUint8(3, Number(chunk.type === 'key') << 7); // Flags

		let simpleBlock = { id: EBMLId.SimpleBlock, data: [
			prelude,
			chunk.data
		] };
		this.#target.writeEBML(simpleBlock);

		this.#duration = Math.max(this.#duration, msTime);
	}

	/**
	 * Replaces a placeholder EBML element with actual CodecPrivate data, then pads it with a Void Element of
	 * necessary size.
	 */
	#writeCodecPrivate(element: EBML, data: AllowSharedBufferSource) {
		let endPos = this.#target.pos;
		this.#target.seek(this.#target.offsets.get(element));

		element = [
			{ id: EBMLId.CodecPrivate, size: 4, data: new Uint8Array(data as ArrayBuffer) },
			{ id: EBMLId.Void, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE - 2 - 4 - data.byteLength) }
		];

		this.#target.writeEBML(element);
		this.#target.seek(endPos);
	}

	/** Creates a new Cluster element to contain video and audio chunks. */
	#createNewCluster(timestamp: number) {
		if (this.#currentCluster) {
			this.#finalizeCurrentCluster();
		}

		this.#currentCluster = { id: EBMLId.Cluster, size: CLUSTER_SIZE_BYTES, data: [
			{ id: EBMLId.Timestamp, data: timestamp }
		] };
		this.#target.writeEBML(this.#currentCluster);

		this.#currentClusterTimestamp = timestamp;

		let clusterOffsetFromSegment =
			this.#target.offsets.get(this.#currentCluster) - this.#segmentDataOffset;

		// Add a CuePoint to the Cues element for better seeking
		(this.#cues.data as EBML[]).push({ id: EBMLId.CuePoint, data: [
			{ id: EBMLId.CueTime, data: timestamp },
			{ id: EBMLId.CueTrackPositions, data: [
				{ id: EBMLId.CueTrack, data: VIDEO_TRACK_NUMBER },
				{ id: EBMLId.CueClusterPosition, data: clusterOffsetFromSegment }
			] }
		] });
	}

	#finalizeCurrentCluster() {
		let clusterSize = this.#target.pos - this.#target.dataOffsets.get(this.#currentCluster);
		let endPos = this.#target.pos;

		// Write the size now that we know it
		this.#target.seek(this.#target.offsets.get(this.#currentCluster) + 4);
		this.#target.writeEBMLVarInt(clusterSize, CLUSTER_SIZE_BYTES);
		this.#target.seek(endPos);
	}

	/** Finalizes the file, making it ready for use. Must be called after all video and audio chunks have been added. */
	finalize() {
		// Flush any remaining queued chunks to the file
		while (this.#videoChunkQueue.length > 0) this.#writeSimpleBlock(this.#videoChunkQueue.shift());
		while (this.#audioChunkQueue.length > 0) this.#writeSimpleBlock(this.#audioChunkQueue.shift());

		this.#finalizeCurrentCluster();
		this.#target.writeEBML(this.#cues);

		let endPos = this.#target.pos;

		// Write the Segment size
		let segmentSize = this.#target.pos - this.#segmentDataOffset;
		this.#target.seek(this.#target.offsets.get(this.#segment) + 4);
		this.#target.writeEBMLVarInt(segmentSize, SEGMENT_SIZE_BYTES);

		// Write the duration of the media to the Segment
		this.#segmentDuration.data = new EBMLFloat64(this.#duration);
		this.#target.seek(this.#target.offsets.get(this.#segmentDuration));
		this.#target.writeEBML(this.#segmentDuration);

		// Fill in SeekHead position data and write it again
		this.#seekHead.data[0].data[1].data =
			this.#target.offsets.get(this.#cues) - this.#segmentDataOffset;
		this.#seekHead.data[1].data[1].data =
			this.#target.offsets.get(this.#segmentInfo) - this.#segmentDataOffset;
		this.#seekHead.data[2].data[1].data =
			this.#target.offsets.get(this.#tracksElement) - this.#segmentDataOffset;

		this.#target.seek(this.#target.offsets.get(this.#seekHead));
		this.#target.writeEBML(this.#seekHead);

		this.#target.seek(endPos);
		this.#finalized = true;

		if (this.#target instanceof ArrayBufferWriteTarget) {
			return this.#target.finalize();
		} else if (this.#target instanceof FileSystemWritableFileStreamWriteTarget) {
			this.#target.finalize();
		} else if (this.#target instanceof StreamingWriteTarget) {
			this.#target.flush(true);
		}

		return null;
	}

	#ensureNotFinalized() {
		if (this.#finalized) {
			throw new Error("Cannot add new video or audio chunks after the file has been finalized.");
		}
	}
}

export default WebMMuxer;

const readBits = (bytes: Uint8Array, start: number, end: number) => {
	let result = 0;

	for (let i = start; i < end; i++) {
		let byteIndex = Math.floor(i / 8);
		let byte = bytes[byteIndex];
		let bitIndex = 0b111 - (i & 0b111);
		let bit = (byte & (1 << bitIndex)) >> bitIndex;

		result <<= 1;
		result |= bit;
	}

	return result;
};
const writeBits = (bytes: Uint8Array, start: number, end: number, value: number) => {
	for (let i = start; i < end; i++) {
		let byteIndex = Math.floor(i / 8);
		let byte = bytes[byteIndex];
		let bitIndex = 0b111 - (i & 0b111);

		byte &= ~(1 << bitIndex);
		byte |= ((value & (1 << (end - i - 1))) >> (end - i - 1)) << bitIndex;
		bytes[byteIndex] = byte;
	}
};