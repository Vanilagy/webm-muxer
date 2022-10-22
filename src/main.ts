import { EBMLElement, EBML, EBMLFloat64, EBMLFloat32, EBMLId } from "./ebml";
import { WriteTarget, ArrayBufferWriteTarget, FileSystemWritableFileStreamWriteTarget } from "./write_target";

const VIDEO_TRACK_NUMBER = 1;
const AUDIO_TRACK_NUMBER = 2;
const MAX_CHUNK_LENGTH_MS = 32_000;

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
		let ebmlHeader: EBML = { id: EBMLId.EBML, data: [
			{ id: EBMLId.EBMLVersion, data: 1 },
			{ id: EBMLId.EBMLReadVersion, data: 1 },
			{ id: EBMLId.EBMLMaxIDLength, data: 4 },
			{ id: EBMLId.EBMLMaxSizeLength, data: 8 },
			{ id: EBMLId.DocType, data: 'webm' },
			{ id: EBMLId.DocTypeVersion, data: 2 },
			{ id: EBMLId.DocTypeReadVersion, data: 2 }
		] };
		this.target.writeEBML(ebmlHeader);

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
		this.seekHead = seekHead;

		let segmentDuration: EBML = { id: EBMLId.Duration, data: new EBMLFloat64(0) };
		this.segmentDuration = segmentDuration;

		let segmentInfo: EBML = { id: EBMLId.Info, data: [
			{ id: EBMLId.TimestampScale, data: 1e6 },
			{ id: EBMLId.MuxingApp, data: "Vani's epic muxer" },
			{ id: EBMLId.WritingApp, data: "Vani's epic muxer" },
			segmentDuration
		] };
		this.segmentInfo = segmentInfo;

		let tracksElement = { id: EBMLId.Tracks, data: [] as EBML[] };
		this.tracksElement = tracksElement;

		if (this.options.video) {
			tracksElement.data.push({ id: EBMLId.TrackEntry, data: [
				{ id: EBMLId.TrackNumber, data: VIDEO_TRACK_NUMBER },
				{ id: EBMLId.TrackUID, data: VIDEO_TRACK_NUMBER },
				{ id: EBMLId.TrackType, data: 1 },
				{ id: EBMLId.CodecID, data: this.options.video.codec },
				(this.options.video.frameRate ? { id: EBMLId.DefaultDuration, data: 1e9/this.options.video.frameRate } : null),
				{ id: EBMLId.Video, data: [
					{ id: EBMLId.PixelWidth, data: this.options.video.width },
					{ id: EBMLId.PixelHeight, data: this.options.video.height }
				] }
			].filter(Boolean) });
		}
		if (this.options.audio) {
			this.audioCodecPrivate = { id: EBMLId.Void, size: 4, data: new Uint8Array(2**11) }; // Reserve 2 kiB for the CodecPrivate element

			tracksElement.data.push({ id: EBMLId.TrackEntry, data: [
				{ id: EBMLId.TrackNumber, data: AUDIO_TRACK_NUMBER },
				{ id: EBMLId.TrackUID, data: AUDIO_TRACK_NUMBER },
				{ id: EBMLId.TrackType, data: 2 },
				{ id: EBMLId.CodecID, data: this.options.audio.codec },
				this.audioCodecPrivate,
				{ id: EBMLId.Audio, data: [
					{ id: EBMLId.SamplingFrequency, data: new EBMLFloat32(this.options.audio.sampleRate) },
					{ id: EBMLId.Channels, data: this.options.audio.numberOfChannels},
					(this.options.audio.bitDepth ? { id: EBMLId.BitDepth, data: this.options.audio.bitDepth } : null)
				].filter(Boolean) }
			] });
		}

		let segment: EBML = { id: EBMLId.Segment, size: 5, data: [
			seekHead,
			segmentInfo,
			tracksElement
		] };
		this.segment = segment;

		this.target.writeEBML(segment);

		this.cues = { id: EBMLId.Cues, data: [] };
	}

	addVideoChunk(chunk: EncodedVideoChunk) {
		this.lastVideoTimestamp = chunk.timestamp;

		while (this.audioChunkQueue.length > 0 && this.audioChunkQueue[0].timestamp <= chunk.timestamp) {
			let audioChunk = this.audioChunkQueue.shift();
			this.writeSimpleBlock(audioChunk);
		}

		if (!this.options.audio || chunk.timestamp <= this.lastAudioTimestamp) {
			this.writeSimpleBlock(chunk);
		} else {
			this.videoChunkQueue.push(chunk);
		}
	}
	
	addAudioChunk(chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata) {
		this.lastAudioTimestamp = chunk.timestamp;

		while (this.videoChunkQueue.length > 0 && this.videoChunkQueue[0].timestamp <= chunk.timestamp) {
			let videoChunk = this.videoChunkQueue.shift();
			this.writeSimpleBlock(videoChunk);
		}

		if (!this.options.video || chunk.timestamp <= this.lastVideoTimestamp) {
			this.writeSimpleBlock(chunk);
		} else {
			this.audioChunkQueue.push(chunk);
		}

		if (meta?.decoderConfig) {
			let endPos = this.target.pos;
			this.target.seek(this.target.offsets.get(this.audioCodecPrivate));

			this.audioCodecPrivate = [
				{ id: EBMLId.CodecPrivate, size: 4, data: new Uint8Array(meta.decoderConfig.description as any) },
				{ id: EBMLId.Void, size: 4, data: new Uint8Array(2**11 - 2 - 4 - meta.decoderConfig.description.byteLength) }
			];
			
			this.target.writeEBML(this.audioCodecPrivate);
			this.target.seek(endPos);
		}
	}

	writeSimpleBlock(chunk: EncodedVideoChunk | EncodedAudioChunk) {
		let msTime = Math.floor(chunk.timestamp / 1000);

		if (
			!this.currentCluster ||
			(chunk instanceof EncodedVideoChunk && chunk.type === 'key' && msTime - this.currentClusterTimestamp >= 1000) ||
			msTime - this.currentClusterTimestamp >= MAX_CHUNK_LENGTH_MS
		) {
			this.createNewCluster(msTime);
		}

		let prelude = new Uint8Array(4);
		let view = new DataView(prelude.buffer);

		view.setUint8(0, 0x80 | ((chunk instanceof EncodedVideoChunk) ? VIDEO_TRACK_NUMBER : AUDIO_TRACK_NUMBER));
		view.setUint16(1, msTime - this.currentClusterTimestamp, false);
		view.setUint8(3, Number(chunk.type === 'key') << 7); // Flags

		let data = new Uint8Array(chunk.byteLength);
		chunk.copyTo(data);

		let simpleBlock = { id: EBMLId.SimpleBlock, data: [
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

		this.currentCluster = { id: EBMLId.Cluster, data: [
			{ id: EBMLId.Timestamp, data: timestamp }
		] };
		this.target.writeEBML(this.currentCluster);

		this.currentClusterTimestamp = timestamp;

		(this.cues.data as EBML[]).push({ id: EBMLId.CuePoint, data: [
			{ id: EBMLId.CueTime, data: timestamp },
			{ id: EBMLId.CueTrackPositions, data: [
				{ id: EBMLId.CueTrack, data: VIDEO_TRACK_NUMBER },
				{ id: EBMLId.CueClusterPosition, data: this.target.offsets.get(this.currentCluster) - (this.target.offsets.get(this.segment) + 8) }
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