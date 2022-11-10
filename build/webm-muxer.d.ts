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

declare global {
	class WebMMuxer {
		constructor(options: WebMMuxerOptions);
	
		addVideoChunk(chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata, timestamp?: number): void;	
		addAudioChunk(chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata, timestamp?: number): void;
		finalize(): ArrayBuffer | null;
	}
}

export = WebMMuxer;