/**
 * Describes the properties used to configure an instance of `Muxer`.
 */
declare interface MuxerOptions<T extends Target> {
	/**
	 * Specifies what happens with the data created by the muxer.
	 */
	target: T,

	/**
	 * When set, declares the existence of a video track in the WebM file and configures that video track.
	 */
	video?: {
		/**
		 * The codec of the encoded video chunks. Typical video codec strings for WebM are `'V_VP8'`, `'V_VP9'`and
		 * `'V_AV1'`. For a full list of possible codecs, visit https://www.matroska.org/technical/codec_specs.html.
		 */
		codec: string,
		/**
		 * The width of the video, in pixels.
		 */
		width: number,
		/**
		 * The height of the video, in pixels.
		 */
		height: number,
		/**
		 * The frame rate of the video, in frames per second. This property is optional and usually used for metadata
		 * only.
		 */
		frameRate?: number,
		/**
		 * Whether the video contains alpha data / transparency.
		 */
		alpha?: boolean
	},

	/**
	 * When set, declares the existence of an audio track in the WebM file and configures that audio track.
	 */
	audio?: {
		/**
		 * The codec of the encoded audio chunks. Typical audio codec strings for WebM are `'A_OPUS'` and `'A_VORBIS'`.
		 * For a full list of possible codecs, visit https://www.matroska.org/technical/codec_specs.html.
		 */
		codec: string,
		/**
		 * The number of audio channels in the audio track.
		 */
		numberOfChannels: number,
		/**
		 * The sample rate in the audio rate, in samples per second per channel.
		 */
		sampleRate: number,
		/**
		 * The bit depth of the audio track. Optional and typically only required for PCM-coded audio.
		 */
		bitDepth?: number
	},

	/**
	 * Configures the muxer to only write data monotonically, useful for live-streaming the WebM as it's being muxed;
	 * intended to be used together with the `target` set to type `function`. When enabled, some features such as
	 * storing duration and seeking will be disabled or impacted, so don't use this option when you want to write out
	 * WebM file for later use.
	 */
	streaming?: boolean,

	/**
	 * Specifies the docType of the muxed multimedia file. This property is optional and defaults to `'webm'`, which is
	 * a subset of the more general container format, Matroska. Using `'matroska'` alongside an .mkv extension will
	 * allow you to use all codecs, not just the ones officially supported by WebM. However, there is generally less
	 * support for .mkv files than there is for .webm and it is less ubiquitous on the web.
	 */
	type?: 'webm' | 'matroska',

	/**
	 * Specifies how to deal with the first chunk in each track having a non-zero timestamp. In the default strict mode,
	 * timestamps must start with 0 to ensure proper playback. However, when directly pumping video frames or audio data
	 * from a MediaTrackStream into the encoder and then the muxer, the timestamps are usually relative to the age of
	 * the document or the computer's clock, which is typically not what we want. Handling of these timestamps must be
	 * set explicitly:
	 *
	 * Use `'offset'` to offset the timestamp of each video track by that track's first chunk's timestamp. This way, it
	 * starts at 0.
	 *
	 * Use `'permissive'` to allow the first timestamp to be non-zero.
	 */
	firstTimestampBehavior?: 'strict' | 'offset' | 'permissive'
}

declare type Target = ArrayBufferTarget | StreamTarget | FileSystemWritableFileStreamTarget;

/** The file data will be written into a single large buffer, which is then stored in `buffer` upon finalization. */
declare class ArrayBufferTarget {
	buffer: ArrayBuffer;
}

/**
 * This target defines callbacks that will get called whenever there is new data available  - this is useful if
 * you want to stream the data, e.g. pipe it somewhere else.
 *
 * When using `chunked: true` in the options, data created by the muxer will first be accumulated and only written out
 * once it has reached sufficient size, using a default chunk size of 16 MiB. This is useful for reducing the total
 * amount of writes, at the cost of latency.
 */
declare class StreamTarget {
	constructor(
		onData: (data: Uint8Array, position: number) => void,
		onDone?: () => void,
		options?: { chunked?: true, chunkSize?: number }
	);
}

/**
 * This is essentially a wrapper around a chunked `StreamTarget` with the intention of simplifying the use of this
 * library with the File System Access API. Writing the file directly to disk as it's being created comes with many
 * benefits, such as creating files way larger than the available RAM.
 */
declare class FileSystemWritableFileStreamTarget {
	constructor(
		stream: FileSystemWritableFileStream,
		options?: { chunkSize?: number }
	);
}

/**
 * Used to multiplex video and audio chunks into a single WebM file. For each WebM file you want to create, create
 * one instance of `Muxer`.
 */
declare class Muxer<T extends Target> {
	target: T;

	/**
	 * Creates a new instance of `Muxer`.
	 * @param options Specifies configuration and metadata for the WebM file.
	 */
	constructor(options: MuxerOptions<T>);

	/**
	 * Adds a new, encoded video chunk to the WebM file.
	 * @param chunk The encoded video chunk. Can be obtained through a `VideoEncoder`.
	 * @param meta The metadata about the encoded video, also provided by `VideoEncoder`.
	 * @param timestamp Optionally, the timestamp to use for the video chunk. When not provided, it will use the one
	 * specified in `chunk`.
	 */
	addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata, timestamp?: number): void;
	/**
	 * Adds a new, encoded audio chunk to the WebM file.
	 * @param chunk The encoded audio chunk. Can be obtained through an `AudioEncoder`.
	 * @param meta The metadata about the encoded audio, also provided by `AudioEncoder`.
	 * @param timestamp Optionally, the timestamp to use for the audio chunk. When not provided, it will use the one
	 * specified in `chunk`.
	 */
	addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata, timestamp?: number): void;

	/**
	 * Adds a raw video chunk to the WebM file. This method should be used when the encoded video is not obtained
	 * through a `VideoEncoder` but through some other means, where no instance of `EncodedVideoChunk`is available.
	 * @param data The raw data of the video chunk.
	 * @param type Whether the video chunk is a keyframe or delta frame.
	 * @param timestamp The timestamp of the video chunk.
	 * @param meta Optionally, any encoder metadata.
	 */
	addVideoChunkRaw(
		data: Uint8Array,
		type: 'key' | 'delta',
		timestamp: number,
		meta?: EncodedVideoChunkMetadata
	): void;
	/**
	 * Adds a raw audio chunk to the WebM file. This method should be used when the encoded audio is not obtained
	 * through an `AudioEncoder` but through some other means, where no instance of `EncodedAudioChunk`is available.
	 * @param data The raw data of the audio chunk.
	 * @param type Whether the audio chunk is a keyframe or delta frame.
	 * @param timestamp The timestamp of the audio chunk.
	 * @param meta Optionally, any encoder metadata.
	 */
	addAudioChunkRaw(
		data: Uint8Array,
		type: 'key' | 'delta',
		timestamp: number,
		meta?: EncodedAudioChunkMetadata
	): void;

	/**
	 * Is to be called after all media chunks have been added to the muxer. Make sure to call and await the `flush`
	 * method on your `VideoEncoder` and/or `AudioEncoder` before calling this method to ensure all encoding has
	 * finished. This method will then finish up the writing process of the WebM file.
	 */
	finalize(): void;
}

declare global {
	let WebMMuxer: typeof WebMMuxer;
}

export { Muxer, ArrayBufferTarget, StreamTarget, FileSystemWritableFileStreamTarget };
export as namespace WebMMuxer;