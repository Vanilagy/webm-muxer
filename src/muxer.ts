import { EBML, EBMLElement, EBMLFloat32, EBMLFloat64, EBMLId } from './ebml';
import { readBits, writeBits } from './misc';
import { ArrayBufferTarget, FileSystemWritableFileStreamTarget, StreamTarget, Target } from './target';
import { EncodedSubtitleChunk, EncodedSubtitleChunkMetadata } from './subtitles';
import {
	ArrayBufferTargetWriter,
	BaseStreamTargetWriter,
	ChunkedStreamTargetWriter,
	FileSystemWritableFileStreamTargetWriter,
	StreamTargetWriter,
	Writer
} from './writer';

const VIDEO_TRACK_NUMBER = 1;
const SUBTITLE_TRACK_NUMBER = 2;
const VIDEO_TRACK_TYPE = 1;
const AUDIO_TRACK_TYPE = 2;
const SUBTITLE_TRACK_TYPE = 17;
const MAX_CHUNK_LENGTH_MS = 2**15;
const CODEC_PRIVATE_MAX_SIZE = 2**12;
const APP_NAME = 'https://github.com/Vanilagy/webm-muxer';
const SEGMENT_SIZE_BYTES = 6;
const CLUSTER_SIZE_BYTES = 5;
const FIRST_TIMESTAMP_BEHAVIORS = ['strict', 'offset', 'permissive'] as const;

export interface AudioTrack {
	trackNumber: number,
	codec: string,
	numberOfChannels: number,
	sampleRate: number,
	bitDepth?: number,
	name?: string,
}

export interface MuxerOptions<T extends Target> {
	target: T,
	video?: {
		codec: string,
		width: number,
		height: number
		frameRate?: number,
		alpha?: boolean
	},
	audio?: AudioTrack[],
	subtitles?: {
		codec: string
	},
	type?: 'webm' | 'matroska',
	firstTimestampBehavior?: typeof FIRST_TIMESTAMP_BEHAVIORS[number],
	streaming?: boolean
}

interface InternalMediaChunk {
	data: Uint8Array,
	additions?: Uint8Array,
	timestamp: number,
	duration?: number,
	type: 'key' | 'delta',
	trackNumber: number
}

interface SeekHead {
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
}

export class Muxer<T extends Target> {
	target: T;

	#options: MuxerOptions<T>;
	#trackNumbers: number[];
	#writer: Writer;

	#segment: EBMLElement;
	#segmentInfo: EBMLElement;
	#seekHead: SeekHead;
	#tracksElement: EBMLElement;
	#segmentDuration: EBMLElement;
	#colourElement: EBMLElement;
	#codecPrivates: EBML[];
	#subtitleCodecPrivate: EBML;
	#cues: EBMLElement;

	#currentCluster: EBMLElement;
	#currentClusterTimestamp: number;

	#duration = 0;
	#chunkQueues: InternalMediaChunk[][] = [];
	#subtitleChunkQueue: InternalMediaChunk[] = [];
	#firstTimestamps: number[] = [];
	#lastTimestamps: number[] = [];
	#lastWrittenTimestamp = -1;
	#colorSpace: VideoColorSpaceInit;
	#finalized = false;

	constructor(options: MuxerOptions<T>) {
		this.#validateOptions(options);

		this.#options = {
			type: 'webm',
			firstTimestampBehavior: 'strict',
			...options
		};
		this.target = options.target;

		// Gather all track numbers
		this.#trackNumbers = [];
		if (this.#options.video) {
			this.#trackNumbers.push(VIDEO_TRACK_NUMBER);
		}
		if (this.#options.audio) {
			for (let track of this.#options.audio) {
				if (this.#trackNumbers.includes(track.trackNumber)) {
					throw new Error(`Duplicated track number: ${track.trackNumber}`);
				}
				this.#trackNumbers.push(track.trackNumber);
			}
		}

		let ensureMonotonicity = !!this.#options.streaming;

		if (options.target instanceof ArrayBufferTarget) {
			this.#writer = new ArrayBufferTargetWriter(options.target);
		} else if (options.target instanceof StreamTarget) {
			this.#writer = options.target.options?.chunked
				? new ChunkedStreamTargetWriter(options.target, ensureMonotonicity)
				: new StreamTargetWriter(options.target, ensureMonotonicity);
		} else if (options.target instanceof FileSystemWritableFileStreamTarget) {
			this.#writer = new FileSystemWritableFileStreamTargetWriter(options.target, ensureMonotonicity);
		} else {
			throw new Error(`Invalid target: ${options.target}`);
		}

		this.#createFileHeader();
	}

	#validateOptions(options: MuxerOptions<T>) {
		if (options.type && options.type !== 'webm' && options.type !== 'matroska') {
			throw new Error(`Invalid type: ${options.type}`);
		}

		if (options.firstTimestampBehavior && !FIRST_TIMESTAMP_BEHAVIORS.includes(options.firstTimestampBehavior)) {
			throw new Error(`Invalid first timestamp behavior: ${options.firstTimestampBehavior}`);
		}
	}

	#createFileHeader() {
		if (this.#writer instanceof BaseStreamTargetWriter && this.#writer.target.options.onHeader) {
			this.#writer.startTrackingWrites();
		}

		this.#writeEBMLHeader();

		if (!this.#options.streaming) {
			this.#createSeekHead();
		}

		this.#createSegmentInfo();
		this.#createCodecPrivatePlaceholders();
		this.#createColourElement();

		if (!this.#options.streaming) {
			this.#createTracks();
			this.#createSegment();
		} else {
			// We'll create these once we write out media chunks
		}

		this.#createCues();

		this.#maybeFlushStreamingTargetWriter();
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
		this.#writer.writeEBML(ebmlHeader);
	}

	/** Reserve 4 kiB for the CodecPrivate elements so we can write them later. */
	#createCodecPrivatePlaceholders() {
		this.#codecPrivates = [];
		for (let trackNumber of this.#trackNumbers) {
			this.#codecPrivates[trackNumber] =
				{ id: EBMLId.Void, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) };
		}

		this.#subtitleCodecPrivate = { id: EBMLId.Void, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) };
	}

	#createColourElement() {
		this.#colourElement = { id: EBMLId.Colour, data: [
			// All initially unspecified
			{ id: EBMLId.MatrixCoefficients, data: 2 },
			{ id: EBMLId.TransferCharacteristics, data: 2 },
			{ id: EBMLId.Primaries, data: 2 },
			{ id: EBMLId.Range, data: 0 }
		] };
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
			!this.#options.streaming ? segmentDuration : null
		] };
		this.#segmentInfo = segmentInfo;
	}

	#createTracks() {
		let tracksElement = { id: EBMLId.Tracks, data: [] as EBML[] };
		this.#tracksElement = tracksElement;

		if (this.#options.video) {
			this.#chunkQueues[VIDEO_TRACK_NUMBER] = [];
			this.#lastTimestamps[VIDEO_TRACK_NUMBER] = -1;

			tracksElement.data.push({ id: EBMLId.TrackEntry, data: [
				{ id: EBMLId.TrackNumber, data: VIDEO_TRACK_NUMBER },
				{ id: EBMLId.TrackUID, data: VIDEO_TRACK_NUMBER },
				{ id: EBMLId.TrackType, data: VIDEO_TRACK_TYPE },
				{ id: EBMLId.CodecID, data: this.#options.video.codec },
				this.#codecPrivates[VIDEO_TRACK_NUMBER],
				(this.#options.video.frameRate ?
					{ id: EBMLId.DefaultDuration, data: 1e9/this.#options.video.frameRate } :
					null
				),
				{ id: EBMLId.Video, data: [
					{ id: EBMLId.PixelWidth, data: this.#options.video.width },
					{ id: EBMLId.PixelHeight, data: this.#options.video.height },
					(this.#options.video.alpha ? { id: EBMLId.AlphaMode, data: 1 } : null),
					this.#colourElement
				] }
			] });
		}

		if (this.#options.audio) {
			for (let track of this.#options.audio) {
				this.#chunkQueues[track.trackNumber] = [];
				this.#lastTimestamps[track.trackNumber] = -1;

				tracksElement.data.push( {
					id: EBMLId.TrackEntry, data: [
						{ id: EBMLId.TrackNumber, data: track.trackNumber },
						{ id: EBMLId.TrackUID, data: track.trackNumber },
						{ id: EBMLId.TrackType, data: AUDIO_TRACK_TYPE },
						track.name ? { id: EBMLId.Name, data: track.name } : null,
						{ id: EBMLId.CodecID, data: track.codec },
						this.#codecPrivates[track.trackNumber],
						{ id: EBMLId.Audio, data: [
							{ id: EBMLId.SamplingFrequency, data: new EBMLFloat32(track.sampleRate) },
							{ id: EBMLId.Channels, data: track.numberOfChannels },
							(track.bitDepth ?
								{ id: EBMLId.BitDepth, data: track.bitDepth } :
								null
							)
						] }
					] } );
			}
		}

		if (this.#options.subtitles) {
			tracksElement.data.push({ id: EBMLId.TrackEntry, data: [
				{ id: EBMLId.TrackNumber, data: SUBTITLE_TRACK_NUMBER },
				{ id: EBMLId.TrackUID, data: SUBTITLE_TRACK_NUMBER },
				{ id: EBMLId.TrackType, data: SUBTITLE_TRACK_TYPE },
				{ id: EBMLId.CodecID, data: this.#options.subtitles.codec },
				this.#subtitleCodecPrivate
			] });
		}
	}

	#createSegment() {
		let segment: EBML = {
			id: EBMLId.Segment,
			size: this.#options.streaming ? -1 : SEGMENT_SIZE_BYTES,
			data: [
				!this.#options.streaming ? this.#seekHead as EBML : null,
				this.#segmentInfo,
				this.#tracksElement
			]
		};
		this.#segment = segment;

		this.#writer.writeEBML(segment);

		if (this.#writer instanceof BaseStreamTargetWriter && this.#writer.target.options.onHeader) {
			let { data, start } = this.#writer.getTrackedWrites(); // start should be 0
			this.#writer.target.options.onHeader(data, start);
		}
	}

	#createCues() {
		this.#cues = { id: EBMLId.Cues, data: [] };
	}

	#maybeFlushStreamingTargetWriter() {
		if (this.#writer instanceof StreamTargetWriter) {
			this.#writer.flush();
		}
	}

	get #segmentDataOffset() {
		return this.#writer.dataOffsets.get(this.#segment);
	}

	addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata, timestamp?: number) {
		let data = new Uint8Array(chunk.byteLength);
		chunk.copyTo(data);

		this.addVideoChunkRaw(data, chunk.type, timestamp ?? chunk.timestamp, meta);
	}

	#writeOrQueueChunk(pending: InternalMediaChunk) {
		/**
		 * Okay, so the algorithm used to insert video and audio blocks (if both are present) is one where we want to
		 * insert the blocks sorted, i.e. always monotonically increasing in timestamp. This means that we can write
		 * an audio chunk of timestamp t_a only when we have a video chunk of timestamp t_v >= t_a, and vice versa.
		 * This means that we need to often queue up a lot of video/audio chunks and wait for their counterpart to
		 * arrive before they are written to the file. When the video writing is finished, it is important that any
		 * chunks remaining in the queues also be flushed to the file.
		 */

		let trackPrevTimestamp = this.#lastTimestamps[pending.trackNumber];
		this.#lastTimestamps[pending.trackNumber] = pending.timestamp;

		// If another track has a smaller timestamp than the current one previously had,
		// this track is already waiting for that track to catch up.
		// Only the track with the smallest timestamp has a chance to move the whole write forward.
		if (trackPrevTimestamp !== this.#lastWrittenTimestamp) {
			this.#chunkQueues[pending.trackNumber].push(pending);
			return;
		}

		// Find the smallest timestamp among the tracks.
		// Future chunks are not allowed to have a smaller timestamp than this,
		// so it's safe to write up to this timestamp.
		let minTimestamp = Infinity;
		for (let trackNumber of this.#trackNumbers) {
			let trackTimestamp = this.#lastTimestamps[trackNumber];
			// It's possible that multiple tracks have the same smallest timestamp,
			// and hold the write back together.
			// This track got a new chunk, but that one still doesn't,
			// so the write still can't continue.
			if (trackTimestamp === this.#lastWrittenTimestamp) {
				this.#chunkQueues[pending.trackNumber].push(pending);
				return;
			}

			if (trackTimestamp < minTimestamp) {
				minTimestamp = trackTimestamp;
			}
		}

		// Gather all chunks from all tracks that can be written now.
		// Because we have checked that at least one track has a new chunk,
		// this array won't be empty.
		let chunks: InternalMediaChunk[] = [];
		for (let trackNumber of this.#trackNumbers) {
			let queue = this.#chunkQueues[trackNumber];
			let index = 0;
			for (; index < queue.length; index++) {
				if (queue[index].timestamp > minTimestamp) {
					break;
				}
				chunks.push(queue[index]);
			}
			queue.splice(0, index);
		}

		chunks.push(pending);
		chunks.sort((a, b) => a.timestamp - b.timestamp);

		for (let chunk of chunks) {
			this.#writeBlock(chunk, !this.#options.video || chunk.trackNumber === VIDEO_TRACK_NUMBER);
		}
		this.#lastWrittenTimestamp = minTimestamp;

		this.#writeSubtitleChunks();
		this.#maybeFlushStreamingTargetWriter();
	}

	addVideoChunkRaw(data: Uint8Array, type: 'key' | 'delta', timestamp: number, meta?: EncodedVideoChunkMetadata) {
		this.#ensureNotFinalized();
		if (!this.#options.video) throw new Error('No video track declared.');

		this.#firstTimestamps[VIDEO_TRACK_NUMBER] ??= timestamp;
		if (meta) this.#writeVideoDecoderConfig(meta);

		let videoChunk = this.#createInternalChunk(data, type, timestamp, VIDEO_TRACK_NUMBER);
		if (this.#options.video.codec === 'V_VP9') this.#fixVP9ColorSpace(videoChunk);

		this.#writeOrQueueChunk(videoChunk);
	}

	/** Writes possible video decoder metadata to the file. */
	#writeVideoDecoderConfig(meta: EncodedVideoChunkMetadata) {
		if (!meta.decoderConfig) return;

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

			if (!this.#options.streaming) {
				let endPos = this.#writer.pos;
				this.#writer.seek(this.#writer.offsets.get(this.#colourElement));
				this.#writer.writeEBML(this.#colourElement);
				this.#writer.seek(endPos);
			}
		}

		if (meta.decoderConfig.description) {
			if (this.#options.streaming) {
				this.#codecPrivates[VIDEO_TRACK_NUMBER] =
					this.#createCodecPrivateElement(meta.decoderConfig.description);
			} else {
				this.#writeCodecPrivate(this.#codecPrivates[VIDEO_TRACK_NUMBER], meta.decoderConfig.description);
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

	addAudioChunk(trackNumber: number, chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata, timestamp?: number) {
		let data = new Uint8Array(chunk.byteLength);
		chunk.copyTo(data);

		this.addAudioChunkRaw(trackNumber, data, chunk.type, timestamp ?? chunk.timestamp, meta);
	}

	addAudioChunkRaw(
		trackNumber: number,
		data: Uint8Array,
		type: 'key' | 'delta',
		timestamp: number,
		meta?: EncodedAudioChunkMetadata
	) {
		this.#ensureNotFinalized();
		if (!this.#options.audio) throw new Error('No audio track declared.');

		this.#firstTimestamps[trackNumber] ??= timestamp;

		// Write possible audio decoder metadata to the file
		if (meta?.decoderConfig) {
			if (this.#options.streaming) {
				this.#codecPrivates[trackNumber] = this.#createCodecPrivateElement(meta.decoderConfig.description);
			} else {
				this.#writeCodecPrivate(this.#codecPrivates[trackNumber], meta.decoderConfig.description);
			}
		}

		let audioChunk = this.#createInternalChunk(data, type, timestamp, trackNumber);
		this.#writeOrQueueChunk(audioChunk);
	}

	addSubtitleChunk(chunk: EncodedSubtitleChunk, meta: EncodedSubtitleChunkMetadata, timestamp?: number) {
		this.#ensureNotFinalized();
		if (!this.#options.subtitles) throw new Error('No subtitle track declared.');

		// Write possible subtitle decoder metadata to the file
		if (meta?.decoderConfig) {
			if (this.#options.streaming) {
				this.#subtitleCodecPrivate = this.#createCodecPrivateElement(meta.decoderConfig.description);
			} else {
				this.#writeCodecPrivate(this.#subtitleCodecPrivate, meta.decoderConfig.description);
			}
		}

		let subtitleChunk = this.#createInternalChunk(
			chunk.body,
			'key',
			timestamp ?? chunk.timestamp,
			SUBTITLE_TRACK_NUMBER,
			chunk.duration,
			chunk.additions
		);

		this.#lastTimestamps[SUBTITLE_TRACK_NUMBER] = subtitleChunk.timestamp;
		this.#subtitleChunkQueue.push(subtitleChunk);

		this.#writeSubtitleChunks();
		this.#maybeFlushStreamingTargetWriter();
	}

	#writeSubtitleChunks() {
		// Writing subtitle chunks is different from video and audio: A subtitle chunk will be written if it's
		// guaranteed that no more media chunks will be written before it, to ensure monotonicity. However, media chunks
		// will NOT wait for subtitle chunks to arrive, as they may never arrive, so that's how non-monotonicity can
		// arrive. But it should be fine, since it's all still in one cluster.

		let queue = this.#subtitleChunkQueue;
		while (queue.length > 0 && queue[0].timestamp <= this.#lastWrittenTimestamp) {
			this.#writeBlock(queue.shift(), !this.#options.video && !this.#options.audio);
		}
	}

	/** Converts a read-only external chunk into an internal one for easier use. */
	#createInternalChunk(
		data: Uint8Array,
		type: 'key' | 'delta',
		timestamp: number,
		trackNumber: number,
		duration?: number,
		additions?: Uint8Array
	) {
		let adjustedTimestamp = this.#validateTimestamp(timestamp, trackNumber);

		let internalChunk: InternalMediaChunk = {
			data,
			additions,
			type,
			timestamp: adjustedTimestamp,
			duration,
			trackNumber
		};

		return internalChunk;
	}

	#validateTimestamp(timestamp: number, trackNumber: number) {
		let lastTimestamp = this.#lastTimestamps[trackNumber];

		if (!this.#options.subtitles || trackNumber !== SUBTITLE_TRACK_NUMBER) {
			let firstTimestamp = this.#firstTimestamps[trackNumber];

			// Check first timestamp behavior
			if (this.#options.firstTimestampBehavior === 'strict' && lastTimestamp === -1 && timestamp !== 0) {
				throw new Error(
					`The first chunk for your media track must have a timestamp of 0 (received ${timestamp}). ` +
					`Non-zero first timestamps are often caused by directly piping frames or audio data ` +
					`from a MediaStreamTrack into the encoder. Their timestamps are typically relative to ` +
					`the age of the document, which is probably what you want.\n\nIf you want to offset all ` +
					`timestamps of a track such that the first one is zero, set firstTimestampBehavior: ` +
					`'offset' in the options.\nIf you want to allow non-zero first timestamps, set ` +
					`firstTimestampBehavior: 'permissive'.\n`
				);
			} else if (this.#options.firstTimestampBehavior === 'offset') {
				timestamp -= firstTimestamp;
			}
		}

		if (timestamp < lastTimestamp) {
			throw new Error(
				`Timestamps must be monotonically increasing (went from ${lastTimestamp} to ${timestamp}).`
			);
		}

		if (timestamp < 0) {
			throw new Error(`Timestamps must be non-negative (received ${timestamp}).`);
		}

		return timestamp;
	}

	/** Writes a block containing media data to the file. */
	#writeBlock(chunk: InternalMediaChunk, canCreateNewCluster: boolean) {
		// When streaming, we create the tracks and segment after we've received the first media chunks.
		// Due to the interlacing algorithm, this code will be run once we've seen one chunk from every media track.
		if (this.#options.streaming && !this.#tracksElement) {
			this.#createTracks();
			this.#createSegment();
		}

		let msTimestamp = Math.floor(chunk.timestamp / 1000);
		let shouldCreateNewClusterFromKeyFrame =
			canCreateNewCluster &&
			chunk.type === 'key' &&
			msTimestamp - this.#currentClusterTimestamp >= 1000;

		if (
			!this.#currentCluster ||
			shouldCreateNewClusterFromKeyFrame
		) {
			this.#createNewCluster(msTimestamp);
		}

		let relativeTimestamp = msTimestamp - this.#currentClusterTimestamp;
		if (relativeTimestamp < 0) {
			// The chunk lies out of the current cluster
			return;
		}

		let clusterIsTooLong = relativeTimestamp >= MAX_CHUNK_LENGTH_MS;
		if (clusterIsTooLong) {
			throw new Error(
				`Current Matroska cluster exceeded its maximum allowed length of ${MAX_CHUNK_LENGTH_MS} ` +
				`milliseconds. In order to produce a correct WebM file, you must pass in a key frame at least every ` +
				`${MAX_CHUNK_LENGTH_MS} milliseconds.`
			);
		}

		let prelude = new Uint8Array(4);
		let view = new DataView(prelude.buffer);
		// 0x80 to indicate it's the last byte of a multi-byte number
		view.setUint8(0, 0x80 | chunk.trackNumber);
		view.setInt16(1, relativeTimestamp, false);

		if (chunk.duration === undefined && !chunk.additions) {
			// No duration or additions, we can write out a SimpleBlock
			view.setUint8(3, Number(chunk.type === 'key') << 7); // Flags (keyframe flag only present for SimpleBlock)

			let simpleBlock = { id: EBMLId.SimpleBlock, data: [
				prelude,
				chunk.data
			] };
			this.#writer.writeEBML(simpleBlock);
		} else {
			let msDuration = Math.floor(chunk.duration / 1000);
			let blockGroup = { id: EBMLId.BlockGroup, data: [
				{ id: EBMLId.Block, data: [
					prelude,
					chunk.data
				] },
				chunk.duration !== undefined ? { id: EBMLId.BlockDuration, data: msDuration } : null,
				chunk.additions ? { id: EBMLId.BlockAdditions, data: chunk.additions } : null
			] };
			this.#writer.writeEBML(blockGroup);
		}

		this.#duration = Math.max(this.#duration, msTimestamp);
	}

	#createCodecPrivateElement(data: AllowSharedBufferSource) {
		return { id: EBMLId.CodecPrivate, size: 4, data: new Uint8Array(data as ArrayBuffer) };
	}

	/**
	 * Replaces a placeholder EBML element with actual CodecPrivate data, then pads it with a Void Element of
	 * necessary size.
	 */
	#writeCodecPrivate(element: EBML, data: AllowSharedBufferSource) {
		let endPos = this.#writer.pos;
		this.#writer.seek(this.#writer.offsets.get(element));

		let codecPrivateElementSize = 2 + 4 + data.byteLength;
		let voidDataSize = CODEC_PRIVATE_MAX_SIZE - codecPrivateElementSize;

		if (voidDataSize < 0) {
			// Truncate the CodecPrivate data. This way, the file will at least still be valid.
			let newByteLength = data.byteLength + voidDataSize;
			if (data instanceof ArrayBuffer) {
				data = data.slice(0, newByteLength);
			} else {
				data = data.buffer.slice(0, newByteLength);
			}
			voidDataSize = 0;
		}

		element = [
			this.#createCodecPrivateElement(data),
			{ id: EBMLId.Void, size: 4, data: new Uint8Array(voidDataSize) }
		];

		this.#writer.writeEBML(element);
		this.#writer.seek(endPos);
	}

	/** Creates a new Cluster element to contain media chunks. */
	#createNewCluster(timestamp: number) {
		if (this.#currentCluster && !this.#options.streaming) {
			this.#finalizeCurrentCluster();
		}

		if (this.#writer instanceof BaseStreamTargetWriter && this.#writer.target.options.onCluster) {
			this.#writer.startTrackingWrites();
		}

		this.#currentCluster = {
			id: EBMLId.Cluster,
			size: this.#options.streaming ? -1 : CLUSTER_SIZE_BYTES,
			data: [
				{ id: EBMLId.Timestamp, data: timestamp }
			]
		};
		this.#writer.writeEBML(this.#currentCluster);

		this.#currentClusterTimestamp = timestamp;

		let clusterOffsetFromSegment =
			this.#writer.offsets.get(this.#currentCluster) - this.#segmentDataOffset;

		// Add a CuePoint to the Cues element for better seeking
		(this.#cues.data as EBML[]).push({ id: EBMLId.CuePoint, data: [
			{ id: EBMLId.CueTime, data: timestamp },
			...this.#trackNumbers.map(trackNumber => ( { id: EBMLId.CueTrackPositions, data: [
				{ id: EBMLId.CueTrack, data: trackNumber },
				{ id: EBMLId.CueClusterPosition, data: clusterOffsetFromSegment }
			] } ) )
		] });
	}

	#finalizeCurrentCluster() {
		let clusterSize = this.#writer.pos - this.#writer.dataOffsets.get(this.#currentCluster);
		let endPos = this.#writer.pos;

		// Write the size now that we know it
		this.#writer.seek(this.#writer.offsets.get(this.#currentCluster) + 4);
		this.#writer.writeEBMLVarInt(clusterSize, CLUSTER_SIZE_BYTES);
		this.#writer.seek(endPos);

		if (this.#writer instanceof BaseStreamTargetWriter && this.#writer.target.options.onCluster) {
			let { data, start } = this.#writer.getTrackedWrites();
			this.#writer.target.options.onCluster(data, start, this.#currentClusterTimestamp);
		}
	}

	/** Finalizes the file, making it ready for use. Must be called after all media chunks have been added. */
	finalize() {
		if (this.#finalized) {
			throw new Error('Cannot finalize a muxer more than once.');
		}

		// Flush any remaining queued chunks to the file
		let chunks: InternalMediaChunk[] = [];
		for (let trackNumber of this.#trackNumbers) {
			let queue = this.#chunkQueues[trackNumber];
			chunks.push(...queue);
			queue.length = 0;
		}

		chunks.sort((a, b) => a.timestamp - b.timestamp);

		for (let chunk of chunks) {
			this.#writeBlock(chunk, !this.#options.video || chunk.trackNumber === VIDEO_TRACK_NUMBER);
		}

		while (this.#subtitleChunkQueue.length > 0 && this.#subtitleChunkQueue[0].timestamp <= this.#duration) {
			this.#writeBlock(this.#subtitleChunkQueue.shift(), false);
		}

		if (!this.#options.streaming) {
			this.#finalizeCurrentCluster();
		}
		this.#writer.writeEBML(this.#cues);

		if (!this.#options.streaming) {
			let endPos = this.#writer.pos;

			// Write the Segment size
			let segmentSize = this.#writer.pos - this.#segmentDataOffset;
			this.#writer.seek(this.#writer.offsets.get(this.#segment) + 4);
			this.#writer.writeEBMLVarInt(segmentSize, SEGMENT_SIZE_BYTES);

			// Write the duration of the media to the Segment
			this.#segmentDuration.data = new EBMLFloat64(this.#duration);
			this.#writer.seek(this.#writer.offsets.get(this.#segmentDuration));
			this.#writer.writeEBML(this.#segmentDuration);

			// Fill in SeekHead position data and write it again
			this.#seekHead.data[0].data[1].data =
				this.#writer.offsets.get(this.#cues) - this.#segmentDataOffset;
			this.#seekHead.data[1].data[1].data =
				this.#writer.offsets.get(this.#segmentInfo) - this.#segmentDataOffset;
			this.#seekHead.data[2].data[1].data =
				this.#writer.offsets.get(this.#tracksElement) - this.#segmentDataOffset;

			this.#writer.seek(this.#writer.offsets.get(this.#seekHead));
			this.#writer.writeEBML(this.#seekHead);

			this.#writer.seek(endPos);
		}

		this.#maybeFlushStreamingTargetWriter();
		this.#writer.finalize();

		this.#finalized = true;
	}

	#ensureNotFinalized() {
		if (this.#finalized) {
			throw new Error('Cannot add new video or audio chunks after the file has been finalized.');
		}
	}
}
