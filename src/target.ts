export type Target = ArrayBufferTarget | StreamTarget | FileSystemWritableFileStreamTarget;

export class ArrayBufferTarget {
	buffer: ArrayBuffer = null;
}

export class StreamTarget {
	constructor(public options: {
		onData?: (data: Uint8Array, position: number) => void,
		onHeader?: (data: Uint8Array, position: number) => void,
		onCluster?: (data: Uint8Array, position: number, timestamp: number) => void,
		chunked?: boolean,
		chunkSize?: number
	}) {}
}

export class FileSystemWritableFileStreamTarget {
	constructor(
		public stream: FileSystemWritableFileStream,
		public options?: { chunkSize?: number }
	) {}
}