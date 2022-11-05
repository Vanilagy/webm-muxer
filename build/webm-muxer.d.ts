declare interface WebMMuxerOptions {
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

declare class WebMMuxer {
	constructor(options: WebMMuxerOptions);

	addVideoChunk(chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata): void;	
	addAudioChunk(chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata): void;
	finalize(): ArrayBuffer | null;
}